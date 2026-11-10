/**
 * The computer opponent: iterative deepening negamax with alpha-beta pruning, a transposition table and a
 * quiescence search. The four difficulty levels share this search and differ in depth, time and deliberate mistakes.
 */
import { FLAG_EN_PASSANT, KING, type Move, PAWN, type Position, QUEEN, WHITE } from "../chess/position";
import type { Difficulty } from "../game/types";
import { evaluate, hasNonPawnMaterial } from "./evaluate";

export interface SearchOptions {
  /** Clock in milliseconds; defaults to performance.now. Injected by tests. */
  now?: () => number;
  /** Random source in [0, 1); defaults to Math.random. Injected by tests. */
  random?: () => number;
}

export interface SearchResult {
  /** Best move found, or null when the side to move has no legal move. */
  move: Move | null;
  /** Score in centipawns from the side to move's point of view. */
  score: number;
  depth: number;
  nodes: number;
}

/** What makes one difficulty level different from another. */
export interface LevelSettings {
  /** Deepest iteration the level is allowed to finish, in plies. */
  maxDepth: number;
  /** Thinking time after which the search is cut off, in milliseconds. */
  timeBudgetMs: number;
  /** How many plies of captures are followed past the nominal depth; UNLIMITED_QUIESCENCE for a full capture search. */
  quiescencePlies: number;
  /** Moves scoring within this many centipawns of the best are candidates to be played instead of it. */
  candidateMarginCentipawns: number;
  /** Each candidate gets a random bonus below this many centipawns before the final choice. Zero plays the best move. */
  noiseCentipawns: number;
  /** Chance per move of a careless moment: looking one ply ahead only, with no capture search at all. */
  blunderChance: number;
}

/** Score of delivering checkmate at the root. A mate found `n` plies away scores `MATE_SCORE - n`. */
export const MATE_SCORE = 30000;

/** Value of LevelSettings.quiescencePlies that means "follow captures until the position is quiet". */
export const UNLIMITED_QUIESCENCE = 64;

/** Per-level search settings. Budgets are wall-clock caps, so slow devices lose depth rather than responsiveness. */
export const LEVEL_SETTINGS: Readonly<Record<Difficulty, Readonly<LevelSettings>>> = {
  easy: {
    maxDepth: 2,
    timeBudgetMs: 300,
    quiescencePlies: 2,
    candidateMarginCentipawns: 160,
    noiseCentipawns: 160,
    blunderChance: 0.35,
  },
  medium: {
    maxDepth: 4,
    timeBudgetMs: 1000,
    quiescencePlies: UNLIMITED_QUIESCENCE,
    candidateMarginCentipawns: 45,
    noiseCentipawns: 45,
    blunderChance: 0,
  },
  hard: {
    maxDepth: 8,
    timeBudgetMs: 700,
    quiescencePlies: UNLIMITED_QUIESCENCE,
    candidateMarginCentipawns: 0,
    noiseCentipawns: 0,
    blunderChance: 0,
  },
  expert: {
    maxDepth: 48,
    timeBudgetMs: 2500,
    quiescencePlies: UNLIMITED_QUIESCENCE,
    candidateMarginCentipawns: 0,
    noiseCentipawns: 0,
    blunderChance: 0,
  },
};

const MAX_PLY = 96;
const INFINITE_SCORE = 32000;
/** Any score beyond this is a forced mate rather than an evaluation. */
const MATE_BOUND = MATE_SCORE - 2 * MAX_PLY;

/** The clock is read once per this many nodes; reading it at every node would cost more than the search itself. */
const NODES_PER_CLOCK_CHECK = 2048;
/** A new iteration usually costs several times the previous one, so starting it late in the budget is wasted work. */
const SOFT_TIME_FRACTION = 0.55;

const TABLE_BITS = 19;
const TABLE_SIZE = 1 << TABLE_BITS;
const TABLE_MASK = TABLE_SIZE - 1;
const BOUND_NONE = 0;
const BOUND_EXACT = 1;
const BOUND_LOWER = 2;
const BOUND_UPPER = 3;

// About 8 MB in total, allocated once: small enough for a phone and never garbage collected mid-game.
const tableKeyLo = new Int32Array(TABLE_SIZE);
const tableKeyHi = new Int32Array(TABLE_SIZE);
const tableMove = new Int32Array(TABLE_SIZE);
const tableScore = new Int16Array(TABLE_SIZE);
const tableDepth = new Int8Array(TABLE_SIZE);
const tableBound = new Uint8Array(TABLE_SIZE);

const HISTORY_LIMIT = 16384;
const historyScores = new Int32Array(2 * 128 * 128);
const killerMoves = new Int32Array(MAX_PLY * 2);
const moveLists: Move[][] = Array.from({ length: MAX_PLY }, (): Move[] => new Array<Move>(256).fill(0));
const moveScores: Int32Array[] = Array.from({ length: MAX_PLY }, (): Int32Array => new Int32Array(256));

const ORDER_TABLE_MOVE = 1 << 30;
const ORDER_CAPTURE = 1 << 24;
const ORDER_PROMOTION = 1 << 23;
const ORDER_KILLER = 1 << 22;

/** Piece worth for ordering captures and for pruning hopeless ones, indexed by piece type. */
const CAPTURE_VALUE: readonly number[] = [0, 100, 320, 330, 500, 950, 2000];

const REVERSE_FUTILITY_MARGIN = 85;
const FUTILITY_MARGIN = 115;
const DELTA_MARGIN = 180;

/** Late move reduction in plies, indexed by `depth * 64 + moveNumber`: the later and deeper, the more is cut. */
const REDUCTIONS = new Int8Array(64 * 64);
for (let depth = 1; depth < 64; depth += 1) {
  for (let moveNumber = 1; moveNumber < 64; moveNumber += 1) {
    REDUCTIONS[depth * 64 + moveNumber] = Math.floor(0.5 + (Math.log(depth) * Math.log(moveNumber)) / 2.4);
  }
}

/**
 * Forgets everything learned in earlier searches. Not needed for correctness: call it when a new game starts so
 * one game cannot influence the next.
 */
export const clearSearchTables = (): void => {
  tableBound.fill(BOUND_NONE);
  tableKeyLo.fill(0);
  tableKeyHi.fill(0);
  tableMove.fill(0);
  historyScores.fill(0);
  killerMoves.fill(0);
};

const isMateScore = (score: number): boolean => score >= MATE_BOUND || score <= -MATE_BOUND;

class Searcher {
  nodes = 0;
  private stopped = false;
  /** False during the first iteration, which always runs to completion so there is always a searched move to play. */
  private canStop = false;
  private readonly startTime: number;
  private readonly useTable: boolean;

  constructor(
    private readonly position: Position,
    private readonly now: () => number,
    private readonly timeBudgetMs: number,
    private readonly quiescencePlies: number,
  ) {
    this.startTime = now();
    // A limited capture search gives different scores for the same position, which must not leak into the shared table.
    this.useTable = quiescencePlies >= UNLIMITED_QUIESCENCE;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  elapsed(): number {
    return this.now() - this.startTime;
  }

  allowStopping(): void {
    this.canStop = true;
  }

  /**
   * Searches every root move to `depth`. `moves` must be legal and is tried in order. Returns the index of the best
   * move, or -1 when the search was stopped before the first move finished. `scoreOut[0]` receives its score.
   */
  searchRoot(moves: readonly Move[], depth: number, scoreOut: number[]): number {
    const position = this.position;
    let alpha = -INFINITE_SCORE;
    let bestIndex = -1;
    for (let index = 0; index < moves.length; index += 1) {
      const move = moves[index];
      const quiet = this.isQuiet(move);
      position.make(move);
      const givesCheck = position.inCheck();
      let score: number;
      if (index === 0) {
        score = -this.negamax(depth - 1, -INFINITE_SCORE, -alpha, 1, givesCheck, true);
      } else {
        let reduction = 0;
        if (depth >= 3 && index >= 4 && quiet && !givesCheck) {
          reduction = Math.min(depth - 2, REDUCTIONS[Math.min(depth, 63) * 64 + Math.min(index, 63)]);
        }
        score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, 1, givesCheck, true);
        if (score > alpha && !this.stopped) {
          score = -this.negamax(depth - 1, -INFINITE_SCORE, -alpha, 1, givesCheck, true);
        }
      }
      position.unmake();
      if (this.stopped) {
        break;
      }
      if (score > alpha) {
        alpha = score;
        bestIndex = index;
      }
    }
    scoreOut[0] = alpha;
    return bestIndex;
  }

  /**
   * Exact score of one root move when it lies inside the window, otherwise a bound. Used after the main search to
   * find out which other moves are nearly as good as the best one.
   */
  scoreRootMove(move: Move, depth: number, alpha: number, beta: number): number {
    const position = this.position;
    position.make(move);
    const score = -this.negamax(depth - 1, -beta, -alpha, 1, position.inCheck(), true);
    position.unmake();
    return score;
  }

  /** Orders moves for the first iteration, before any search has said which is best. */
  orderRootMoves(moves: Move[]): void {
    const scores = moveScores[0];
    for (let index = 0; index < moves.length; index += 1) {
      moveLists[0][index] = moves[index];
    }
    this.scoreMoves(moveLists[0], scores, moves.length, this.tableMoveFor(), 0);
    for (let index = 0; index < moves.length; index += 1) {
      moves[index] = this.pickNext(moveLists[0], scores, index, moves.length);
    }
  }

  private tableMoveFor(): Move {
    const position = this.position;
    const slot = position.hashLo & TABLE_MASK;
    if (
      this.useTable &&
      tableBound[slot] !== BOUND_NONE &&
      tableKeyLo[slot] === position.hashLo &&
      tableKeyHi[slot] === position.hashHi
    ) {
      return tableMove[slot];
    }
    return 0;
  }

  private isQuiet(move: Move): boolean {
    return this.position.board[(move >> 7) & 127] === 0 && ((move >> 14) & 7) === 0 && move >> 17 !== FLAG_EN_PASSANT;
  }

  private checkClock(): void {
    if (this.canStop && this.now() - this.startTime >= this.timeBudgetMs) {
      this.stopped = true;
    }
  }

  private scoreMoves(moves: Move[], scores: Int32Array, count: number, tableMoveHint: Move, ply: number): void {
    const board = this.position.board;
    const historyBase = this.position.turn << 14;
    const firstKiller = killerMoves[ply * 2];
    const secondKiller = killerMoves[ply * 2 + 1];
    for (let index = 0; index < count; index += 1) {
      const move = moves[index];
      if (move === tableMoveHint) {
        scores[index] = ORDER_TABLE_MOVE;
        continue;
      }
      const from = move & 127;
      const to = (move >> 7) & 127;
      const promotion = (move >> 14) & 7;
      const victim = move >> 17 === FLAG_EN_PASSANT ? PAWN : board[to] & 7;
      if (victim !== 0) {
        // Most valuable victim first, and among equals the least valuable attacker.
        scores[index] = ORDER_CAPTURE + victim * 16 - (board[from] & 7) + (promotion === QUEEN ? 64 : 0);
      } else if (promotion !== 0) {
        scores[index] = promotion === QUEEN ? ORDER_PROMOTION : -HISTORY_LIMIT - 1;
      } else if (move === firstKiller) {
        scores[index] = ORDER_KILLER;
      } else if (move === secondKiller) {
        scores[index] = ORDER_KILLER - 1;
      } else {
        scores[index] = historyScores[historyBase + (from << 7) + to];
      }
    }
  }

  /** Swaps the best remaining move into `index` and returns it. Cheaper than a full sort when a cutoff comes early. */
  private pickNext(moves: Move[], scores: Int32Array, index: number, count: number): Move {
    let best = index;
    let bestScore = scores[index];
    for (let other = index + 1; other < count; other += 1) {
      if (scores[other] > bestScore) {
        bestScore = scores[other];
        best = other;
      }
    }
    const move = moves[best];
    moves[best] = moves[index];
    scores[best] = scores[index];
    moves[index] = move;
    scores[index] = bestScore;
    return move;
  }

  private updateHistory(color: number, move: Move, bonus: number): void {
    const index = (color << 14) + ((move & 127) << 7) + ((move >> 7) & 127);
    // The pull back towards zero keeps scores bounded and lets recent results outweigh stale ones.
    historyScores[index] += bonus - Math.trunc((historyScores[index] * Math.abs(bonus)) / HISTORY_LIMIT);
  }

  private negamax(depthIn: number, alphaIn: number, betaIn: number, ply: number, inCheck: boolean, allowNull: boolean): number {
    if (this.stopped) {
      return 0;
    }
    const position = this.position;

    // Draws by rule. A single earlier occurrence already counts: if repeating is the best the line offers, it is a draw.
    if (position.halfmoveClock >= 100) {
      return 0;
    }
    if (position.halfmoveClock >= 4 && position.repetitionCount() >= 1) {
      return 0;
    }
    // Material only changes on a capture or promotion, both of which reset the half-move clock.
    if (position.halfmoveClock === 0 && position.hasInsufficientMaterial()) {
      return 0;
    }
    if (ply >= MAX_PLY - 1) {
      return evaluate(position);
    }

    // Checking moves are forcing, so follow them one ply further instead of evaluating in the middle of an attack.
    const depth = inCheck ? depthIn + 1 : depthIn;
    if (depth <= 0) {
      return this.quiescence(alphaIn, betaIn, ply, 0);
    }

    this.nodes += 1;
    if ((this.nodes & (NODES_PER_CLOCK_CHECK - 1)) === 0) {
      this.checkClock();
      if (this.stopped) {
        return 0;
      }
    }

    // No line from here can beat mating on the next ply or be worse than being mated right now.
    let alpha = Math.max(alphaIn, -MATE_SCORE + ply);
    const beta = Math.min(betaIn, MATE_SCORE - ply - 1);
    if (alpha >= beta) {
      return alpha;
    }
    const originalAlpha = alpha;
    const isPrincipal = beta - alpha > 1;

    const hashLo = position.hashLo;
    const hashHi = position.hashHi;
    const slot = hashLo & TABLE_MASK;
    let tableMoveHint = 0;
    if (this.useTable && tableBound[slot] !== BOUND_NONE && tableKeyLo[slot] === hashLo && tableKeyHi[slot] === hashHi) {
      tableMoveHint = tableMove[slot];
      if (!isPrincipal && tableDepth[slot] >= depth) {
        let score = tableScore[slot];
        // Mate scores are stored relative to the node and converted back to "plies from the root" here.
        if (score >= MATE_BOUND) {
          score -= ply;
        } else if (score <= -MATE_BOUND) {
          score += ply;
        }
        const bound = tableBound[slot];
        if (
          bound === BOUND_EXACT ||
          (bound === BOUND_LOWER && score >= beta) ||
          (bound === BOUND_UPPER && score <= alpha)
        ) {
          return score;
        }
      }
    }

    let staticScore = -INFINITE_SCORE;
    if (!inCheck) {
      staticScore = evaluate(position);
      if (!isPrincipal && beta < MATE_BOUND && beta > -MATE_BOUND) {
        // Already far above beta near the leaves: the opponent will not let us get here.
        if (depth <= 4 && staticScore - REVERSE_FUTILITY_MARGIN * depth >= beta) {
          return staticScore;
        }
        // If we can pass and still be above beta, a real move will be too. Unsound when only pawns are left.
        if (allowNull && depth >= 3 && staticScore >= beta && hasNonPawnMaterial(position, position.turn)) {
          const reduction = depth >= 6 ? 3 : 2;
          position.makeNull();
          const score = -this.negamax(depth - 1 - reduction, -beta, -beta + 1, ply + 1, false, false);
          position.unmakeNull();
          if (this.stopped) {
            return 0;
          }
          if (score >= beta) {
            return beta;
          }
        }
      }
    }

    const moves = moveLists[ply];
    const scores = moveScores[ply];
    const count = position.generateMoves(moves);
    this.scoreMoves(moves, scores, count, tableMoveHint, ply);

    const us = position.turn;
    let bestScore = -INFINITE_SCORE;
    let bestMove = 0;
    let legalMoves = 0;
    let quietMoves = 0;

    for (let index = 0; index < count; index += 1) {
      const move = this.pickNext(moves, scores, index, count);
      const quiet = this.isQuiet(move);
      if (!position.make(move)) {
        continue;
      }
      legalMoves += 1;
      const givesCheck = position.inCheck();

      if (quiet && !givesCheck && !inCheck && legalMoves > 1 && bestScore > -MATE_BOUND) {
        // Near the leaves a quiet move cannot be expected to gain more than a margin over the static score.
        const futile = depth <= 2 && staticScore + FUTILITY_MARGIN * depth + 60 <= alpha;
        // And after many quiet moves have failed, the rest (ordered worst last) are skipped outright.
        const late = !isPrincipal && depth <= 3 && quietMoves > 3 + 3 * depth * depth;
        if (futile || late) {
          position.unmake();
          continue;
        }
      }
      if (quiet) {
        quietMoves += 1;
      }

      let score: number;
      if (legalMoves === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, givesCheck, true);
      } else {
        let reduction = 0;
        if (depth >= 3 && legalMoves > 3 && quiet && !givesCheck && !inCheck) {
          reduction = REDUCTIONS[Math.min(depth, 63) * 64 + Math.min(legalMoves, 63)];
          if (isPrincipal || scores[index] >= ORDER_KILLER - 1) {
            reduction -= 1;
          }
          reduction = Math.max(0, Math.min(depth - 2, reduction));
        }
        score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, givesCheck, true);
        if (score > alpha && reduction > 0) {
          score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, givesCheck, true);
        }
        if (score > alpha && score < beta) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, givesCheck, true);
        }
      }
      position.unmake();
      if (this.stopped) {
        return 0;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) {
            if (quiet) {
              this.rewardCutoff(us, move, moves, index, depth, ply);
            }
            break;
          }
        }
      }
    }

    if (legalMoves === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    if (this.useTable && (tableBound[slot] === BOUND_NONE || tableKeyLo[slot] !== hashLo || tableKeyHi[slot] !== hashHi || depth >= tableDepth[slot] - 2)) {
      let stored = bestScore;
      if (stored >= MATE_BOUND) {
        stored += ply;
      } else if (stored <= -MATE_BOUND) {
        stored -= ply;
      }
      tableKeyLo[slot] = hashLo;
      tableKeyHi[slot] = hashHi;
      tableMove[slot] = bestMove;
      tableScore[slot] = stored;
      tableDepth[slot] = Math.min(depth, 127);
      tableBound[slot] = bestScore >= beta ? BOUND_LOWER : bestScore > originalAlpha ? BOUND_EXACT : BOUND_UPPER;
    }
    return bestScore;
  }

  /** A quiet move refuted the line: remember it for sibling nodes and mark down the quiet moves tried before it. */
  private rewardCutoff(color: number, move: Move, moves: Move[], index: number, depth: number, ply: number): void {
    if (killerMoves[ply * 2] !== move) {
      killerMoves[ply * 2 + 1] = killerMoves[ply * 2];
      killerMoves[ply * 2] = move;
    }
    const bonus = Math.min(depth * depth, 400);
    this.updateHistory(color, move, bonus);
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (this.isQuiet(moves[earlier])) {
        this.updateHistory(color, moves[earlier], -bonus);
      }
    }
  }

  /** Plays out captures until the position is quiet, so the static evaluation is never taken mid-exchange. */
  private quiescence(alphaIn: number, beta: number, ply: number, capturePly: number): number {
    this.nodes += 1;
    if ((this.nodes & (NODES_PER_CLOCK_CHECK - 1)) === 0) {
      this.checkClock();
    }
    if (this.stopped) {
      return 0;
    }
    const position = this.position;
    const standPat = evaluate(position);
    if (standPat >= beta || capturePly >= this.quiescencePlies || ply >= MAX_PLY - 1) {
      return standPat;
    }
    let alpha = alphaIn > standPat ? alphaIn : standPat;
    let bestScore = standPat;

    const board = position.board;
    const moves = moveLists[ply];
    const scores = moveScores[ply];
    const count = position.generateMoves(moves, true);
    this.scoreMoves(moves, scores, count, 0, ply);
    const enemyPawn = ((position.turn ^ 1) << 3) | PAWN;
    // Enemy pawns capture towards us, so the pawns defending a square stand one rank beyond it from our side.
    const pawnRank = position.turn === WHITE ? 16 : -16;

    for (let index = 0; index < count; index += 1) {
      const move = this.pickNext(moves, scores, index, count);
      const to = (move >> 7) & 127;
      const promotion = (move >> 14) & 7;
      if (promotion !== 0 && promotion !== QUEEN) {
        continue;
      }
      const victim = move >> 17 === FLAG_EN_PASSANT ? PAWN : board[to] & 7;
      if (victim === KING) {
        continue;
      }
      if (promotion === 0) {
        // Even winning the piece for free would not bring the score back up to alpha.
        if (standPat + CAPTURE_VALUE[victim] + DELTA_MARGIN <= alpha) {
          continue;
        }
        // Taking a pawn-protected piece with a more valuable one simply loses material.
        const attacker = board[move & 127] & 7;
        if (attacker !== KING && CAPTURE_VALUE[attacker] > CAPTURE_VALUE[victim] + 50) {
          const left = to + pawnRank - 1;
          const right = to + pawnRank + 1;
          if ((!(left & 0x88) && board[left] === enemyPawn) || (!(right & 0x88) && board[right] === enemyPawn)) {
            continue;
          }
        }
      }
      if (!position.make(move)) {
        continue;
      }
      const score = -this.quiescence(-beta, -alpha, ply + 1, capturePly + 1);
      position.unmake();
      if (this.stopped) {
        return 0;
      }
      if (score > bestScore) {
        bestScore = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) {
            break;
          }
        }
      }
    }
    return bestScore;
  }
}

/** Moves the element at `index` to the front, keeping the others in order. */
const promoteToFront = (moves: Move[], index: number): void => {
  const move = moves[index];
  for (let position = index; position > 0; position -= 1) {
    moves[position] = moves[position - 1];
  }
  moves[0] = move;
};

/**
 * Chooses a move for the side to move at the given difficulty. The position is searched in place and restored
 * before returning. The result's move is null only when there is no legal move (checkmate or stalemate).
 */
export const chooseMove = (position: Position, difficulty: Difficulty, options: SearchOptions = {}): SearchResult => {
  const settings = LEVEL_SETTINGS[difficulty];
  const now = options.now ?? ((): number => performance.now());
  const random = options.random ?? Math.random;

  const rootMoves = position.legalMoves();
  if (rootMoves.length === 0) {
    return { move: null, score: position.inCheck() ? -MATE_SCORE : 0, depth: 0, nodes: 0 };
  }

  // In a careless moment the level sees only the immediate result of its own move.
  const careless = settings.blunderChance > 0 && random() < settings.blunderChance;
  const maxDepth = careless ? 1 : settings.maxDepth;
  const quiescencePlies = careless ? 0 : settings.quiescencePlies;

  const searcher = new Searcher(position, now, settings.timeBudgetMs, quiescencePlies);
  searcher.orderRootMoves(rootMoves);

  const softLimit = settings.timeBudgetMs * SOFT_TIME_FRACTION;
  const scoreOut = [0];
  let bestScore = 0;
  let completedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const bestIndex = searcher.searchRoot(rootMoves, depth, scoreOut);
    // A stopped iteration still counts when it got past its first move: that move was the previous best, so the
    // partial result is either the same move confirmed more deeply or a move proven better than it.
    if (bestIndex >= 0) {
      promoteToFront(rootMoves, bestIndex);
      bestScore = scoreOut[0];
    }
    if (searcher.isStopped) {
      break;
    }
    completedDepth = depth;
    searcher.allowStopping();
    // Thinking longer cannot change a forced move, and a forced mate needs no second opinion.
    if (rootMoves.length === 1 || isMateScore(bestScore) || searcher.elapsed() >= softLimit) {
      break;
    }
  }

  let chosen = rootMoves[0];
  let chosenScore = bestScore;
  if (settings.noiseCentipawns > 0 && !isMateScore(bestScore) && rootMoves.length > 1) {
    const floor = bestScore - settings.candidateMarginCentipawns;
    let chosenNoisy = bestScore + random() * settings.noiseCentipawns;
    for (let index = 1; index < rootMoves.length && !searcher.isStopped; index += 1) {
      const score = searcher.scoreRootMove(rootMoves[index], completedDepth, floor - 1, bestScore + 1);
      if (searcher.isStopped || score < floor) {
        continue;
      }
      const capped = Math.min(score, bestScore);
      const noisy = capped + random() * settings.noiseCentipawns;
      if (noisy > chosenNoisy) {
        chosenNoisy = noisy;
        chosen = rootMoves[index];
        chosenScore = capped;
      }
    }
  }

  return { move: chosen, score: chosenScore, depth: completedDepth, nodes: searcher.nodes };
};
