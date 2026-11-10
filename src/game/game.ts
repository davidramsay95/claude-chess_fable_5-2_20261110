import { moveToSan } from "../chess/notation";
import {
  BLACK,
  FLAG_EN_PASSANT,
  type Move,
  Position,
  START_FEN,
  WHITE,
  moveFlag,
  moveTo,
  moveToUci,
} from "../chess/position";
import { DIFFICULTIES, type Difficulty, type PlayerColor } from "./types";

/** The portable saved-game object shared by every game on the site. See `game_state.json` in the host repository. */
export interface GameState {
  version: 1;
  startFen: string;
  playerColor: PlayerColor;
  difficulty: Difficulty;
  moves: string[];
  resigned: boolean;
}

export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "*";
export type EndReason = "checkmate" | "stalemate" | "threefold" | "fifty-move" | "insufficient" | "resignation";

export interface Outcome {
  result: GameResult;
  /** Null while the game is still in progress. */
  reason: EndReason | null;
}

export interface GameSummary {
  result: GameResult;
  moveCount: number;
}

export interface PlyRecord {
  move: Move;
  uci: string;
  san: string;
  /** Piece code that was captured, or 0. */
  captured: number;
  fenAfter: string;
}

/** Thrown when an imported state is not valid. The message is short and safe to show to the user. */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

// Generous upper bound that still keeps a hostile import from tying up the page.
const MAX_MOVES = 12000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDifficulty = (value: unknown): value is Difficulty => DIFFICULTIES.some((difficulty) => difficulty === value);

/**
 * Identity of a position for the repetition rule: placement, side to move, castling rights, and the en passant
 * square only when a capture there is actually legal (a pinned pawn does not make the position different).
 */
const repetitionKey = (position: Position): string => {
  const [placement, turn, castling] = position.toFen().split(" ");
  const enPassantPlayable =
    position.epSquare !== -1 && position.legalMoves().some((move) => moveFlag(move) === FLAG_EN_PASSANT);
  return `${placement} ${turn} ${castling} ${enPassantPlayable ? position.epSquare : "-"}`;
};

/** One game between the human and the engine: the moves played so far and the rules that decide when it ends. */
export class Game {
  readonly startFen: string;
  readonly playerColor: PlayerColor;
  readonly difficulty: Difficulty;
  /** The live position after every move in `plies`. Treat as read-only outside this class. */
  readonly position: Position;
  readonly plies: PlyRecord[] = [];
  private resigned = false;
  private readonly keys: string[];
  private cachedOutcome: Outcome | null = null;

  private constructor(startFen: string, playerColor: PlayerColor, difficulty: Difficulty) {
    this.startFen = startFen;
    this.playerColor = playerColor;
    this.difficulty = difficulty;
    this.position = Position.fromFen(startFen);
    this.keys = [repetitionKey(this.position)];
  }

  /** Starts a new game from the standard position. */
  static create(playerColor: PlayerColor, difficulty: Difficulty): Game {
    return new Game(START_FEN, playerColor, difficulty);
  }

  /**
   * Validates a saved state and replays every move through the rules.
   * @throws StateError when anything about the state is invalid. Nothing outside the new game is touched.
   */
  static fromState(value: unknown): Game {
    if (!isRecord(value)) {
      throw new StateError("The game state must be a JSON object");
    }
    if (value.version !== 1) {
      throw new StateError("Unsupported version: expected 1");
    }
    if (typeof value.startFen !== "string") {
      throw new StateError("startFen must be a FEN string");
    }
    if (value.playerColor !== "white" && value.playerColor !== "black") {
      throw new StateError('playerColor must be "white" or "black"');
    }
    if (!isDifficulty(value.difficulty)) {
      throw new StateError("difficulty must be easy, medium, hard or expert");
    }
    if (!Array.isArray(value.moves)) {
      throw new StateError("moves must be a list of UCI moves");
    }
    if (value.moves.length > MAX_MOVES) {
      throw new StateError("moves is too long");
    }
    if (typeof value.resigned !== "boolean") {
      throw new StateError("resigned must be true or false");
    }

    let game: Game;
    try {
      game = new Game(value.startFen, value.playerColor, value.difficulty);
    } catch (error) {
      throw new StateError(`startFen is not valid (${error instanceof Error ? error.message : "unknown error"})`);
    }
    const moves: unknown[] = value.moves;
    moves.forEach((uci, index) => {
      if (typeof uci !== "string") {
        throw new StateError(`Move ${index + 1} is not a string`);
      }
      const move = game.position.findMove(uci);
      if (move === null) {
        throw new StateError(`Move ${index + 1} (${uci.slice(0, 12)}) is not legal`);
      }
      game.apply(move);
    });
    game.resigned = value.resigned;
    return game;
  }

  /** The exportable state. `Game.fromState(game.toState())` gives an equal game. */
  toState(): GameState {
    return {
      version: 1,
      startFen: this.startFen,
      playerColor: this.playerColor,
      difficulty: this.difficulty,
      moves: this.plies.map((ply) => ply.uci),
      resigned: this.resigned,
    };
  }

  summary(): GameSummary {
    return { result: this.outcome.result, moveCount: this.plies.length };
  }

  /** Result of the game as it stands. A finish on the board takes precedence over a resignation flag. */
  get outcome(): Outcome {
    this.cachedOutcome ??= this.computeOutcome();
    return this.cachedOutcome;
  }

  get isOver(): boolean {
    return this.outcome.reason !== null;
  }

  isHumanTurn(): boolean {
    return (this.position.turn === WHITE) === (this.playerColor === "white");
  }

  legalMoves(): Move[] {
    return this.isOver ? [] : this.position.legalMoves();
  }

  /** Plays a move given as UCI. Returns false, changing nothing, when the game is over or the move is not legal. */
  playUci(uci: string): boolean {
    if (this.isOver) {
      return false;
    }
    const move = this.position.findMove(uci);
    if (move === null) {
      return false;
    }
    this.apply(move);
    return true;
  }

  /** The human gives up. Has no effect once the game is over. */
  resign(): void {
    if (!this.isOver) {
      this.resigned = true;
      this.cachedOutcome = null;
    }
  }

  /** FEN after `plyCount` half-moves; 0 is the starting position. */
  fenAt(plyCount: number): string {
    return plyCount <= 0 ? this.startFen : this.plies[Math.min(plyCount, this.plies.length) - 1].fenAfter;
  }

  private apply(move: Move): void {
    const position = this.position;
    const mover = position.turn;
    const captured =
      moveFlag(move) === FLAG_EN_PASSANT
        ? position.board[moveTo(move) + (mover === WHITE ? -16 : 16)]
        : position.board[moveTo(move)];
    const san = moveToSan(position, move);
    position.make(move);
    this.plies.push({ move, uci: moveToUci(move), san, captured, fenAfter: position.toFen() });
    this.keys.push(repetitionKey(position));
    this.cachedOutcome = null;
  }

  private computeOutcome(): Outcome {
    const position = this.position;
    if (position.legalMoves().length === 0) {
      if (!position.inCheck()) {
        return { result: "1/2-1/2", reason: "stalemate" };
      }
      return { result: position.turn === BLACK ? "1-0" : "0-1", reason: "checkmate" };
    }
    if (this.resigned) {
      return { result: this.playerColor === "white" ? "0-1" : "1-0", reason: "resignation" };
    }
    if (position.hasInsufficientMaterial()) {
      return { result: "1/2-1/2", reason: "insufficient" };
    }
    const current = this.keys[this.keys.length - 1];
    if (this.keys.filter((key) => key === current).length >= 3) {
      return { result: "1/2-1/2", reason: "threefold" };
    }
    if (position.halfmoveClock >= 100) {
      return { result: "1/2-1/2", reason: "fifty-move" };
    }
    return { result: "*", reason: null };
  }
}
