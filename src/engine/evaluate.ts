/**
 * Static evaluation. Everything is accumulated as white minus black in two scores, one for the middlegame and one
 * for the endgame, which are blended by how much material is left. All numbers are this project's own.
 */
import {
  BISHOP,
  BISHOP_OFFSETS,
  BLACK,
  KING,
  KNIGHT,
  KNIGHT_OFFSETS,
  PAWN,
  type Position,
  QUEEN,
  ROOK,
  ROOK_OFFSETS,
  WHITE,
} from "../chess/position";

const MIDDLEGAME_VALUE: readonly number[] = [0, 88, 318, 332, 492, 955, 0];
const ENDGAME_VALUE: readonly number[] = [0, 118, 296, 314, 528, 962, 0];

/** How much each piece type counts towards "this is still a middlegame"; a full board adds up to MAX_PHASE. */
const PHASE_WEIGHT: readonly number[] = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;

/** Rough piece worth in pawns, used only for the material-balance rules at the end of the evaluation. */
const UNIT_VALUE: readonly number[] = [0, 0, 3, 3, 5, 9, 0];

const TEMPO_BONUS = 9;

const BISHOP_PAIR_MIDDLEGAME = 30;
const BISHOP_PAIR_ENDGAME = 46;

const DOUBLED_MIDDLEGAME = 9;
const DOUBLED_ENDGAME = 19;
const ISOLATED_MIDDLEGAME = 12;
const ISOLATED_ENDGAME = 13;

/** Passed pawn bonus by how many ranks the pawn has advanced from its own back rank. */
const PASSED_MIDDLEGAME: readonly number[] = [0, 4, 7, 14, 28, 50, 78, 0];
const PASSED_ENDGAME: readonly number[] = [0, 9, 15, 29, 54, 92, 146, 0];

const ROOK_OPEN_FILE_MIDDLEGAME = 22;
const ROOK_OPEN_FILE_ENDGAME = 9;
const ROOK_HALF_OPEN_FILE_MIDDLEGAME = 11;
const ROOK_HALF_OPEN_FILE_ENDGAME = 5;

/** Per reachable square beyond MOBILITY_BASELINE, indexed by piece type. */
const MOBILITY_MIDDLEGAME: readonly number[] = [0, 0, 4, 4, 2, 1, 0];
const MOBILITY_ENDGAME: readonly number[] = [0, 0, 4, 4, 4, 2, 0];
const MOBILITY_BASELINE: readonly number[] = [0, 0, 4, 6, 6, 12, 0];

/** Pressure a piece type adds for each square it hits next to the enemy king. */
const KING_ATTACK_WEIGHT: readonly number[] = [0, 0, 2, 2, 3, 5, 0];
const KING_ATTACK_LIMIT = 280;

const SHIELD_CLOSE = 11;
const SHIELD_ADVANCED = 5;
const SHIELD_MISSING = 15;
const SHIELD_FILE_OPEN = 8;

const MOP_UP_EDGE = 16;
const MOP_UP_KINGS_CLOSE = 10;

const WHITE_PAWN = PAWN;
const BLACK_PAWN = 8 | PAWN;
const WHITE_KNIGHT = KNIGHT;
const BLACK_KNIGHT = 8 | KNIGHT;
const WHITE_BISHOP = BISHOP;
const BLACK_BISHOP = 8 | BISHOP;
const WHITE_ROOK = ROOK;
const BLACK_ROOK = 8 | ROOK;
const WHITE_QUEEN = QUEEN;
const BLACK_QUEEN = 8 | QUEEN;

/** Positional bonus for a white piece of `type` on `file`, `rank` in the middlegame. */
const middlegameSquareBonus = (type: number, file: number, rank: number): number => {
  const fileCentre = Math.min(file, 7 - file);
  const rankCentre = Math.min(rank, 7 - rank);
  const centre = fileCentre + rankCentre;
  switch (type) {
    case PAWN: {
      let bonus = [0, 0, 2, 5, 11, 21, 38, 0][rank];
      if (fileCentre === 3) {
        // Central pawns should step forward; leaving them at home blocks the bishops.
        bonus += [0, -14, 2, 20, 24, 8, 0, 0][rank];
      } else if (fileCentre === 2) {
        bonus += [0, -2, 2, 8, 8, 2, 0, 0][rank];
      } else if (rank === 1) {
        bonus += 6;
      }
      return bonus;
    }
    case KNIGHT:
      return 10 * centre - 34 + (rank === 4 || rank === 5 ? 7 : 0) - (rank === 0 ? 8 : 0);
    case BISHOP:
      return 5 * centre - 13 + (file === rank || file === 7 - rank ? 4 : 0) - (rank === 0 ? 9 : 0);
    case ROOK:
      return 3 * fileCentre - 4 + (rank === 6 ? 15 : 0);
    case QUEEN:
      return 2 * centre - 6 - (rank === 0 ? 3 : 0);
    case KING:
      if (rank === 0) {
        return [16, 30, 6, -10, -4, -10, 32, 18][file];
      }
      if (rank === 1) {
        return [2, 4, -12, -24, -24, -12, 4, 2][file];
      }
      return Math.max(-64, -34 - 10 * (rank - 2));
    default:
      return 0;
  }
};

/** Positional bonus for a white piece of `type` on `file`, `rank` in the endgame. */
const endgameSquareBonus = (type: number, file: number, rank: number): number => {
  const fileCentre = Math.min(file, 7 - file);
  const centre = fileCentre + Math.min(rank, 7 - rank);
  switch (type) {
    case PAWN:
      // Rook pawns are the hardest to promote, so they get a little less for advancing.
      return [0, 0, 4, 10, 20, 36, 60, 0][rank] - (fileCentre === 0 ? 4 : 0);
    case KNIGHT:
      return 6 * centre - 20;
    case BISHOP:
      return 4 * centre - 11;
    case ROOK:
      return rank === 6 ? 10 : 0;
    case QUEEN:
      return 5 * centre - 14;
    case KING:
      return 9 * centre - 28;
    default:
      return 0;
  }
};

/** Material plus square bonus, indexed by `piece * 128 + square`, already negated for black pieces. */
const MIDDLEGAME_TABLE = new Int16Array(16 * 128);
const ENDGAME_TABLE = new Int16Array(16 * 128);
for (let type = PAWN; type <= KING; type += 1) {
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const middlegame = MIDDLEGAME_VALUE[type] + middlegameSquareBonus(type, file, rank);
      const endgame = ENDGAME_VALUE[type] + endgameSquareBonus(type, file, rank);
      const whiteIndex = type * 128 + rank * 16 + file;
      const blackIndex = (8 | type) * 128 + (7 - rank) * 16 + file;
      MIDDLEGAME_TABLE[whiteIndex] = middlegame;
      ENDGAME_TABLE[whiteIndex] = endgame;
      MIDDLEGAME_TABLE[blackIndex] = -middlegame;
      ENDGAME_TABLE[blackIndex] = -endgame;
    }
  }
}

/** King-step distance between two squares, indexed by `a - b + 119`. A 0x88 difference identifies the offset uniquely. */
const DISTANCE = new Uint8Array(239);
/** Steps from the four centre squares, 0 to 6, indexed by square. */
const CENTRE_DISTANCE = new Uint8Array(128);
for (let from = 0; from < 120; from += 1) {
  if (from & 0x88) {
    continue;
  }
  const file = from & 7;
  const rank = from >> 4;
  CENTRE_DISTANCE[from] = Math.max(3 - file, file - 4) + Math.max(3 - rank, rank - 4);
  for (let to = 0; to < 120; to += 1) {
    if (!(to & 0x88)) {
      DISTANCE[from - to + 119] = Math.max(Math.abs(file - (to & 7)), Math.abs(rank - (to >> 4)));
    }
  }
}

// Scratch buffers reused by every call; the search is single threaded so they are never shared.
// Pawn ranks per file are stored at index `file + 1` so the neighbours of the a and h files need no bounds checks.
const whiteLowestPawn = new Int8Array(10);
const whiteHighestPawn = new Int8Array(10);
const blackLowestPawn = new Int8Array(10);
const blackHighestPawn = new Int8Array(10);
const pieceCounts = new Uint8Array(16);
const pawnSquares = new Uint8Array(16);
const pieceSquares = new Uint8Array(32);
const kingAttackUnits = [0, 0];
const kingAttackers = [0, 0];

const NO_PAWN_LOW = 8;
const NO_PAWN_HIGH = -1;

/** Middlegame score for the pawns in front of a castled king, from that king's own point of view. */
const pawnShield = (kingSquare: number, color: number): number => {
  const relativeRank = color === WHITE ? kingSquare >> 4 : 7 - (kingSquare >> 4);
  const kingFile = kingSquare & 7;
  // A king still in the middle gets nothing here, otherwise it would be rewarded for never moving its centre pawns.
  if (relativeRank > 1 || kingFile === 3 || kingFile === 4) {
    return 0;
  }
  let score = 0;
  const firstFile = Math.max(0, kingFile - 1);
  const lastFile = Math.min(7, kingFile + 1);
  for (let file = firstFile; file <= lastFile; file += 1) {
    const hasOwnPawn = color === WHITE ? whiteHighestPawn[file + 1] >= 0 : blackHighestPawn[file + 1] >= 0;
    if (!hasOwnPawn) {
      const hasEnemyPawn = color === WHITE ? blackHighestPawn[file + 1] >= 0 : whiteHighestPawn[file + 1] >= 0;
      score -= hasEnemyPawn ? SHIELD_MISSING : SHIELD_MISSING + SHIELD_FILE_OPEN;
      continue;
    }
    const nearestRank = color === WHITE ? whiteLowestPawn[file + 1] : 7 - blackHighestPawn[file + 1];
    if (nearestRank === 1) {
      score += SHIELD_CLOSE;
    } else if (nearestRank === 2) {
      score += SHIELD_ADVANCED;
    }
  }
  return score;
};

/** Bonus for the side with mating material against a bare king: push that king to the edge and bring ours close. */
const mopUp = (strongKing: number, weakKing: number, cornerOnly: boolean, bishopOnDark: boolean): number => {
  const file = weakKing & 7;
  const rank = weakKing >> 4;
  let edge = CENTRE_DISTANCE[weakKing];
  if (cornerOnly) {
    // Bishop and knight can only mate in a corner the bishop controls, so the other two corners are no better than the centre.
    const toDarkCorner = Math.min(file + rank, 14 - file - rank);
    const toLightCorner = Math.min(file + 7 - rank, 7 - file + rank);
    edge = 7 - (bishopOnDark ? toDarkCorner : toLightCorner);
  }
  return 60 + MOP_UP_EDGE * edge + MOP_UP_KINGS_CLOSE * (7 - DISTANCE[strongKing - weakKing + 119]);
};

/**
 * Static score of the position in centipawns from the point of view of the side to move. Positive is good for the
 * mover. Does not look at check, checkmate or stalemate; the search handles those.
 */
export const evaluate = (position: Position): number => {
  const board = position.board;
  whiteLowestPawn.fill(NO_PAWN_LOW);
  blackLowestPawn.fill(NO_PAWN_LOW);
  whiteHighestPawn.fill(NO_PAWN_HIGH);
  blackHighestPawn.fill(NO_PAWN_HIGH);
  pieceCounts.fill(0);

  let middlegame = 0;
  let endgame = 0;
  let phase = 0;
  let pawnCount = 0;
  let pieceCount = 0;
  let lightBishops = 0;
  let darkBishops = 0;
  let whiteBishopOnDark = false;
  let blackBishopOnDark = false;

  for (let square = 0; square < 120; square += 1) {
    if (square & 0x88) {
      square += 7;
      continue;
    }
    const piece = board[square];
    if (piece === 0) {
      continue;
    }
    const tableIndex = (piece << 7) + square;
    middlegame += MIDDLEGAME_TABLE[tableIndex];
    endgame += ENDGAME_TABLE[tableIndex];
    pieceCounts[piece] += 1;
    const type = piece & 7;
    if (type === PAWN) {
      const fileIndex = (square & 7) + 1;
      const rank = square >> 4;
      if (piece === WHITE_PAWN) {
        if (rank < whiteLowestPawn[fileIndex]) {
          whiteLowestPawn[fileIndex] = rank;
        }
        if (rank > whiteHighestPawn[fileIndex]) {
          whiteHighestPawn[fileIndex] = rank;
        }
      } else {
        if (rank < blackLowestPawn[fileIndex]) {
          blackLowestPawn[fileIndex] = rank;
        }
        if (rank > blackHighestPawn[fileIndex]) {
          blackHighestPawn[fileIndex] = rank;
        }
      }
      pawnSquares[pawnCount] = square;
      pawnCount += 1;
    } else if (type !== KING) {
      pieceSquares[pieceCount] = square;
      pieceCount += 1;
      phase += PHASE_WEIGHT[type];
      if (type === BISHOP) {
        const onDark = (((square >> 4) + square) & 1) === 0;
        if (onDark) {
          darkBishops += 1;
        } else {
          lightBishops += 1;
        }
        if (piece === WHITE_BISHOP) {
          whiteBishopOnDark = onDark;
        } else {
          blackBishopOnDark = onDark;
        }
      }
    }
  }

  const whiteKnights = pieceCounts[WHITE_KNIGHT];
  const blackKnights = pieceCounts[BLACK_KNIGHT];
  const whiteBishops = pieceCounts[WHITE_BISHOP];
  const blackBishops = pieceCounts[BLACK_BISHOP];
  const whiteHeavy = pieceCounts[WHITE_ROOK] + pieceCounts[WHITE_QUEEN];
  const blackHeavy = pieceCounts[BLACK_ROOK] + pieceCounts[BLACK_QUEEN];

  // Same rule as Position.hasInsufficientMaterial, answered from the counts already gathered.
  if (pawnCount === 0 && whiteHeavy + blackHeavy === 0) {
    const minors = whiteKnights + blackKnights + whiteBishops + blackBishops;
    if (minors <= 1 || (whiteKnights + blackKnights === 0 && (lightBishops === 0 || darkBishops === 0))) {
      return 0;
    }
  }

  const whiteKing = position.kingSquare[WHITE];
  const blackKing = position.kingSquare[BLACK];

  for (let index = 0; index < pawnCount; index += 1) {
    const square = pawnSquares[index];
    const fileIndex = (square & 7) + 1;
    const rank = square >> 4;
    if (board[square] === WHITE_PAWN) {
      if (whiteHighestPawn[fileIndex] > rank) {
        middlegame -= DOUBLED_MIDDLEGAME;
        endgame -= DOUBLED_ENDGAME;
      }
      if (whiteHighestPawn[fileIndex - 1] < 0 && whiteHighestPawn[fileIndex + 1] < 0) {
        middlegame -= ISOLATED_MIDDLEGAME;
        endgame -= ISOLATED_ENDGAME;
      }
      if (
        whiteHighestPawn[fileIndex] === rank &&
        blackHighestPawn[fileIndex - 1] <= rank &&
        blackHighestPawn[fileIndex] <= rank &&
        blackHighestPawn[fileIndex + 1] <= rank
      ) {
        middlegame += PASSED_MIDDLEGAME[rank];
        endgame += PASSED_ENDGAME[rank];
        if (rank >= 3) {
          // In the endgame a passed pawn is worth more when our king escorts it and theirs is far from its path.
          const ahead = square + 16;
          endgame += (4 * DISTANCE[blackKing - ahead + 119] - 2 * DISTANCE[whiteKing - ahead + 119]) * (rank - 2);
        }
      }
    } else {
      const advanced = 7 - rank;
      if (blackLowestPawn[fileIndex] < rank) {
        middlegame += DOUBLED_MIDDLEGAME;
        endgame += DOUBLED_ENDGAME;
      }
      if (blackHighestPawn[fileIndex - 1] < 0 && blackHighestPawn[fileIndex + 1] < 0) {
        middlegame += ISOLATED_MIDDLEGAME;
        endgame += ISOLATED_ENDGAME;
      }
      if (
        blackLowestPawn[fileIndex] === rank &&
        whiteLowestPawn[fileIndex - 1] >= rank &&
        whiteLowestPawn[fileIndex] >= rank &&
        whiteLowestPawn[fileIndex + 1] >= rank
      ) {
        middlegame -= PASSED_MIDDLEGAME[advanced];
        endgame -= PASSED_ENDGAME[advanced];
        if (advanced >= 3) {
          const ahead = square - 16;
          endgame -= (4 * DISTANCE[whiteKing - ahead + 119] - 2 * DISTANCE[blackKing - ahead + 119]) * (advanced - 2);
        }
      }
    }
  }

  kingAttackUnits[WHITE] = 0;
  kingAttackUnits[BLACK] = 0;
  kingAttackers[WHITE] = 0;
  kingAttackers[BLACK] = 0;

  for (let index = 0; index < pieceCount; index += 1) {
    const square = pieceSquares[index];
    const piece = board[square];
    const type = piece & 7;
    const color = piece >> 3;
    const sign = color === WHITE ? 1 : -1;
    // Offset so that DISTANCE[target + enemyKingOffset] is the distance from target to the enemy king.
    const enemyKingOffset = 119 - (color === WHITE ? blackKing : whiteKing);
    let mobility = 0;
    let kingHits = 0;

    if (type === KNIGHT) {
      for (let direction = 0; direction < 8; direction += 1) {
        const target = square + KNIGHT_OFFSETS[direction];
        if (target & 0x88) {
          continue;
        }
        const occupant = board[target];
        if (occupant === 0 || occupant >> 3 !== color) {
          mobility += 1;
        }
        if (DISTANCE[target + enemyKingOffset] <= 1) {
          kingHits += 1;
        }
      }
    } else {
      if (type !== ROOK) {
        for (let direction = 0; direction < 4; direction += 1) {
          const step = BISHOP_OFFSETS[direction];
          for (let target = square + step; !(target & 0x88); target += step) {
            const occupant = board[target];
            if (occupant === 0 || occupant >> 3 !== color) {
              mobility += 1;
            }
            if (DISTANCE[target + enemyKingOffset] <= 1) {
              kingHits += 1;
            }
            if (occupant !== 0) {
              break;
            }
          }
        }
      }
      if (type !== BISHOP) {
        for (let direction = 0; direction < 4; direction += 1) {
          const step = ROOK_OFFSETS[direction];
          for (let target = square + step; !(target & 0x88); target += step) {
            const occupant = board[target];
            if (occupant === 0 || occupant >> 3 !== color) {
              mobility += 1;
            }
            if (DISTANCE[target + enemyKingOffset] <= 1) {
              kingHits += 1;
            }
            if (occupant !== 0) {
              break;
            }
          }
        }
      }
      if (type === ROOK) {
        const fileIndex = (square & 7) + 1;
        const ownPawn = color === WHITE ? whiteHighestPawn[fileIndex] >= 0 : blackHighestPawn[fileIndex] >= 0;
        if (!ownPawn) {
          const enemyPawn = color === WHITE ? blackHighestPawn[fileIndex] >= 0 : whiteHighestPawn[fileIndex] >= 0;
          middlegame += sign * (enemyPawn ? ROOK_HALF_OPEN_FILE_MIDDLEGAME : ROOK_OPEN_FILE_MIDDLEGAME);
          endgame += sign * (enemyPawn ? ROOK_HALF_OPEN_FILE_ENDGAME : ROOK_OPEN_FILE_ENDGAME);
        }
      }
    }

    const extraSquares = mobility - MOBILITY_BASELINE[type];
    middlegame += sign * MOBILITY_MIDDLEGAME[type] * extraSquares;
    endgame += sign * MOBILITY_ENDGAME[type] * extraSquares;
    if (kingHits > 0) {
      kingAttackUnits[color] += kingHits * KING_ATTACK_WEIGHT[type];
      kingAttackers[color] += 1;
    }
  }

  // One piece near the king is a nuisance; pressure only becomes dangerous with a queen and a helper.
  if (kingAttackers[WHITE] >= 2 && pieceCounts[WHITE_QUEEN] > 0) {
    middlegame += Math.min(KING_ATTACK_LIMIT, (kingAttackUnits[WHITE] * kingAttackUnits[WHITE]) >> 2);
  }
  if (kingAttackers[BLACK] >= 2 && pieceCounts[BLACK_QUEEN] > 0) {
    middlegame -= Math.min(KING_ATTACK_LIMIT, (kingAttackUnits[BLACK] * kingAttackUnits[BLACK]) >> 2);
  }

  middlegame += pawnShield(whiteKing, WHITE) - pawnShield(blackKing, BLACK);

  if (whiteBishops >= 2) {
    middlegame += BISHOP_PAIR_MIDDLEGAME;
    endgame += BISHOP_PAIR_ENDGAME;
  }
  if (blackBishops >= 2) {
    middlegame -= BISHOP_PAIR_MIDDLEGAME;
    endgame -= BISHOP_PAIR_ENDGAME;
  }

  const blend = phase > MAX_PHASE ? MAX_PHASE : phase;
  // Truncating towards zero (not flooring) keeps the score exactly antisymmetric between the two colours.
  let score = Math.trunc((middlegame * blend + endgame * (MAX_PHASE - blend)) / MAX_PHASE);

  const whitePawns = pieceCounts[WHITE_PAWN];
  const blackPawns = pieceCounts[BLACK_PAWN];
  const whiteUnits =
    UNIT_VALUE[KNIGHT] * whiteKnights +
    UNIT_VALUE[BISHOP] * whiteBishops +
    UNIT_VALUE[ROOK] * pieceCounts[WHITE_ROOK] +
    UNIT_VALUE[QUEEN] * pieceCounts[WHITE_QUEEN];
  const blackUnits =
    UNIT_VALUE[KNIGHT] * blackKnights +
    UNIT_VALUE[BISHOP] * blackBishops +
    UNIT_VALUE[ROOK] * pieceCounts[BLACK_ROOK] +
    UNIT_VALUE[QUEEN] * pieceCounts[BLACK_QUEEN];

  if (blackUnits === 0 && blackPawns === 0 && whiteUnits >= 5 && !(whiteHeavy === 0 && whiteBishops === 0)) {
    const cornerOnly = whiteHeavy === 0 && whitePawns === 0 && whiteBishops === 1 && whiteKnights === 1;
    score += mopUp(whiteKing, blackKing, cornerOnly, whiteBishopOnDark);
  } else if (whiteUnits === 0 && whitePawns === 0 && blackUnits >= 5 && !(blackHeavy === 0 && blackBishops === 0)) {
    const cornerOnly = blackHeavy === 0 && blackPawns === 0 && blackBishops === 1 && blackKnights === 1;
    score -= mopUp(blackKing, whiteKing, cornerOnly, blackBishopOnDark);
  }

  // Without pawns, being up less than a rook's worth (or having only knights against a bare king) rarely wins.
  if (score > 0 && whitePawns === 0) {
    if (whiteUnits - blackUnits < 4 || (whiteHeavy === 0 && whiteBishops === 0 && whiteKnights <= 2 && blackUnits === 0)) {
      score = Math.trunc(score / 8);
    }
  } else if (score < 0 && blackPawns === 0) {
    if (blackUnits - whiteUnits < 4 || (blackHeavy === 0 && blackBishops === 0 && blackKnights <= 2 && whiteUnits === 0)) {
      score = Math.trunc(score / 8);
    }
  }

  return (position.turn === WHITE ? score : -score) + TEMPO_BONUS;
};

/**
 * True when `color` owns a knight, bishop, rook or queen. The search uses it to switch off null-move pruning in
 * pawn endings, where passing can genuinely be the best "move" and the pruning would be unsound.
 */
export const hasNonPawnMaterial = (position: Position, color: number): boolean => {
  const board = position.board;
  for (let square = 0; square < 120; square += 1) {
    if (square & 0x88) {
      square += 7;
      continue;
    }
    const piece = board[square];
    if (piece !== 0 && piece >> 3 === color) {
      const type = piece & 7;
      if (type !== PAWN && type !== KING) {
        return true;
      }
    }
  }
  return false;
};
