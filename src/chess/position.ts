/**
 * Chess rules on a 0x88 board: square = rank * 16 + file, so `square & 0x88` is non-zero exactly when a step
 * has walked off the board. One mutable Position is shared by the interface and the search, with make/unmake.
 */

/** A move packed into an integer: from (7 bits), to (7 bits), promotion piece type (3 bits), flag (3 bits). */
export type Move = number;
export type Color = 0 | 1;

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const FLAG_NONE = 0;
export const FLAG_DOUBLE_PUSH = 1;
export const FLAG_EN_PASSANT = 2;
export const FLAG_CASTLE_KING = 3;
export const FLAG_CASTLE_QUEEN = 4;

export const CASTLE_WHITE_KING = 1;
export const CASTLE_WHITE_QUEEN = 2;
export const CASTLE_BLACK_KING = 4;
export const CASTLE_BLACK_QUEEN = 8;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const KNIGHT_OFFSETS: readonly number[] = [-33, -31, -18, -14, 14, 18, 31, 33];
export const KING_OFFSETS: readonly number[] = [-17, -16, -15, -1, 1, 15, 16, 17];
export const BISHOP_OFFSETS: readonly number[] = [-17, -15, 15, 17];
export const ROOK_OFFSETS: readonly number[] = [-16, -1, 1, 16];

export const makePiece = (color: number, type: number): number => (color << 3) | type;
export const pieceColor = (piece: number): number => piece >> 3;
export const pieceType = (piece: number): number => piece & 7;

export const toSquare = (file: number, rank: number): number => rank * 16 + file;
export const squareFile = (square: number): number => square & 7;
export const squareRank = (square: number): number => square >> 4;
export const squareName = (square: number): string => `${"abcdefgh"[square & 7]}${(square >> 4) + 1}`;

/** Parses a square such as `e4`. Returns -1 when the text is not a square. */
export const parseSquareName = (name: string): number => {
  if (!/^[a-h][1-8]$/.test(name)) {
    return -1;
  }
  return toSquare(name.charCodeAt(0) - 97, name.charCodeAt(1) - 49);
};

export const encodeMove = (from: number, to: number, promotion = 0, flag = FLAG_NONE): Move =>
  from | (to << 7) | (promotion << 14) | (flag << 17);
export const moveFrom = (move: Move): number => move & 127;
export const moveTo = (move: Move): number => (move >> 7) & 127;
/** Piece type the pawn promotes to, or 0. */
export const movePromotion = (move: Move): number => (move >> 14) & 7;
export const moveFlag = (move: Move): number => move >> 17;

const PROMOTION_LETTERS = ["", "", "n", "b", "r", "q"];

/** UCI text for a move: `e2e4`, `e1g1` for castling, `e7e8q` for promotion. */
export const moveToUci = (move: Move): string =>
  `${squareName(moveFrom(move))}${squareName(moveTo(move))}${PROMOTION_LETTERS[movePromotion(move)]}`;

const PIECE_LETTERS = " PNBRQK  pnbrqk";

const A1 = 0;
const E1 = 4;
const H1 = 7;
const A8 = 112;
const E8 = 116;
const H8 = 119;

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[A1] = 15 & ~CASTLE_WHITE_QUEEN;
CASTLE_MASK[E1] = 15 & ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN);
CASTLE_MASK[H1] = 15 & ~CASTLE_WHITE_KING;
CASTLE_MASK[A8] = 15 & ~CASTLE_BLACK_QUEEN;
CASTLE_MASK[E8] = 15 & ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
CASTLE_MASK[H8] = 15 & ~CASTLE_BLACK_KING;

// Zobrist keys come from a fixed seed so hashes are identical in the page, the worker and the tests.
let zobristSeed = 0x9e3779b9;
const nextRandom = (): number => {
  zobristSeed ^= zobristSeed << 13;
  zobristSeed ^= zobristSeed >>> 17;
  zobristSeed ^= zobristSeed << 5;
  return zobristSeed | 0;
};
const randomTable = (length: number): Int32Array => Int32Array.from({ length }, nextRandom);

const Z_PIECE_LO = randomTable(16 * 128);
const Z_PIECE_HI = randomTable(16 * 128);
const Z_CASTLE_LO = randomTable(16);
const Z_CASTLE_HI = randomTable(16);
const Z_EP_LO = randomTable(8);
const Z_EP_HI = randomTable(8);
const Z_TURN_LO = nextRandom();
const Z_TURN_HI = nextRandom();

const parseCounter = (text: string | undefined, fallback: number, minimum: number, name: string): number => {
  if (text === undefined) {
    return fallback;
  }
  if (!/^\d{1,5}$/.test(text) || Number(text) < minimum) {
    throw new Error(`Invalid FEN: bad ${name}`);
  }
  return Number(text);
};

export class Position {
  /** 128 entries; 0 is empty, otherwise `color << 3 | type`. */
  readonly board = new Uint8Array(128);
  turn: number = WHITE;
  /** Bit set of the CASTLE_* constants. */
  castling = 0;
  /** Square a pawn can capture onto en passant, or -1. Only set when an enemy pawn stands next to the pushed pawn. */
  epSquare = -1;
  halfmoveClock = 0;
  fullmoveNumber = 1;
  readonly kingSquare: number[] = [0, 0];
  /** Zobrist hash, split into two 32-bit halves because JavaScript bit operations are 32-bit. */
  hashLo = 0;
  hashHi = 0;
  /** Number of moves made on this object since it was created from a FEN. */
  ply = 0;

  private readonly undoMove: number[] = [];
  private readonly undoCaptured: number[] = [];
  private readonly undoCastling: number[] = [];
  private readonly undoEp: number[] = [];
  private readonly undoHalfmove: number[] = [];
  private readonly undoHashLo: number[] = [];
  private readonly undoHashHi: number[] = [];

  /**
   * Builds a position from a FEN string. The clocks may be omitted.
   * @throws Error when the FEN is malformed or describes a position that cannot occur with this side to move.
   */
  static fromFen(fen: string): Position {
    if (typeof fen !== "string") {
      throw new Error("Invalid FEN: not a string");
    }
    const fields = fen.trim().split(/\s+/);
    if (fields.length < 4 || fields.length > 6) {
      throw new Error("Invalid FEN: expected 4 to 6 fields");
    }
    const [placement, turn, castling, enPassant, halfmove, fullmove] = fields;
    const position = new Position();
    const board = position.board;

    const ranks = placement.split("/");
    if (ranks.length !== 8) {
      throw new Error("Invalid FEN: expected 8 ranks");
    }
    const kings = [0, 0];
    ranks.forEach((rankText, index) => {
      const rank = 7 - index;
      let file = 0;
      for (const character of rankText) {
        if (character >= "1" && character <= "8") {
          file += Number(character);
          continue;
        }
        const piece = PIECE_LETTERS.indexOf(character);
        if (piece <= 0 || character === " " || file > 7) {
          throw new Error("Invalid FEN: bad piece placement");
        }
        if (pieceType(piece) === PAWN && (rank === 0 || rank === 7)) {
          throw new Error("Invalid FEN: pawn on the first or last rank");
        }
        if (pieceType(piece) === KING) {
          kings[pieceColor(piece)] += 1;
          position.kingSquare[pieceColor(piece)] = toSquare(file, rank);
        }
        board[toSquare(file, rank)] = piece;
        file += 1;
      }
      if (file !== 8) {
        throw new Error("Invalid FEN: a rank does not have 8 squares");
      }
    });
    if (kings[WHITE] !== 1 || kings[BLACK] !== 1) {
      throw new Error("Invalid FEN: each side needs exactly one king");
    }

    if (turn !== "w" && turn !== "b") {
      throw new Error("Invalid FEN: bad side to move");
    }
    position.turn = turn === "w" ? WHITE : BLACK;

    if (!/^(-|K?Q?k?q?)$/.test(castling) || castling === "") {
      throw new Error("Invalid FEN: bad castling rights");
    }
    const whiteKingHome = board[E1] === makePiece(WHITE, KING);
    const blackKingHome = board[E8] === makePiece(BLACK, KING);
    const rights: [string, number, boolean][] = [
      ["K", CASTLE_WHITE_KING, whiteKingHome && board[H1] === makePiece(WHITE, ROOK)],
      ["Q", CASTLE_WHITE_QUEEN, whiteKingHome && board[A1] === makePiece(WHITE, ROOK)],
      ["k", CASTLE_BLACK_KING, blackKingHome && board[H8] === makePiece(BLACK, ROOK)],
      ["q", CASTLE_BLACK_QUEEN, blackKingHome && board[A8] === makePiece(BLACK, ROOK)],
    ];
    for (const [letter, bit, supported] of rights) {
      if (castling.includes(letter) && supported) {
        position.castling |= bit;
      }
    }

    if (enPassant !== "-") {
      const square = parseSquareName(enPassant);
      const us = position.turn;
      const them = us ^ 1;
      if (square === -1 || squareRank(square) !== (us === WHITE ? 5 : 2)) {
        throw new Error("Invalid FEN: bad en passant square");
      }
      const pushed = us === WHITE ? square - 16 : square + 16;
      if (board[pushed] !== makePiece(them, PAWN) || board[square] !== 0) {
        throw new Error("Invalid FEN: en passant square without a pushed pawn");
      }
      if (position.pawnStandsBeside(pushed, us)) {
        position.epSquare = square;
      }
    }

    position.halfmoveClock = parseCounter(halfmove, 0, 0, "half-move clock");
    position.fullmoveNumber = parseCounter(fullmove, 1, 1, "move number");

    if (position.isSquareAttacked(position.kingSquare[position.turn ^ 1], position.turn)) {
      throw new Error("Invalid FEN: the side that just moved is in check");
    }
    position.computeHash();
    return position;
  }

  toFen(): string {
    const ranks: string[] = [];
    for (let rank = 7; rank >= 0; rank -= 1) {
      let text = "";
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = this.board[toSquare(file, rank)];
        if (piece === 0) {
          empty += 1;
          continue;
        }
        text += `${empty > 0 ? empty : ""}${PIECE_LETTERS[piece]}`;
        empty = 0;
      }
      ranks.push(`${text}${empty > 0 ? empty : ""}`);
    }
    const castling =
      `${this.castling & CASTLE_WHITE_KING ? "K" : ""}${this.castling & CASTLE_WHITE_QUEEN ? "Q" : ""}` +
      `${this.castling & CASTLE_BLACK_KING ? "k" : ""}${this.castling & CASTLE_BLACK_QUEEN ? "q" : ""}`;
    const enPassant = this.epSquare === -1 ? "-" : squareName(this.epSquare);
    return `${ranks.join("/")} ${this.turn === WHITE ? "w" : "b"} ${castling || "-"} ${enPassant} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  /**
   * Writes pseudo-legal moves for the side to move into `out` from index 0 and returns how many there are.
   * A pseudo-legal move may leave the mover's king in check; `make` rejects those. Castling is fully checked here.
   * With `capturesOnly`, only captures, en passant and promotions are produced.
   */
  generateMoves(out: Move[], capturesOnly = false): number {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    let count = 0;

    for (let square = 0; square < 120; square += 1) {
      if (square & 0x88) {
        square += 7;
        continue;
      }
      const piece = board[square];
      if (piece === 0 || piece >> 3 !== us) {
        continue;
      }
      const type = piece & 7;

      if (type === PAWN) {
        const forward = us === WHITE ? 16 : -16;
        const rank = square >> 4;
        const promotes = rank === (us === WHITE ? 6 : 1);
        const ahead = square + forward;
        if (board[ahead] === 0) {
          if (promotes) {
            out[count++] = encodeMove(square, ahead, QUEEN);
            out[count++] = encodeMove(square, ahead, KNIGHT);
            out[count++] = encodeMove(square, ahead, ROOK);
            out[count++] = encodeMove(square, ahead, BISHOP);
          } else if (!capturesOnly) {
            out[count++] = encodeMove(square, ahead);
            if (rank === (us === WHITE ? 1 : 6) && board[ahead + forward] === 0) {
              out[count++] = encodeMove(square, ahead + forward, 0, FLAG_DOUBLE_PUSH);
            }
          }
        }
        for (let side = -1; side <= 1; side += 2) {
          const target = ahead + side;
          if (target & 0x88) {
            continue;
          }
          const victim = board[target];
          if (victim !== 0 && victim >> 3 === them) {
            if (promotes) {
              out[count++] = encodeMove(square, target, QUEEN);
              out[count++] = encodeMove(square, target, KNIGHT);
              out[count++] = encodeMove(square, target, ROOK);
              out[count++] = encodeMove(square, target, BISHOP);
            } else {
              out[count++] = encodeMove(square, target);
            }
          } else if (target === this.epSquare) {
            out[count++] = encodeMove(square, target, 0, FLAG_EN_PASSANT);
          }
        }
        continue;
      }

      if (type === KNIGHT || type === KING) {
        const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (let index = 0; index < 8; index += 1) {
          const target = square + offsets[index];
          if (target & 0x88) {
            continue;
          }
          const victim = board[target];
          if (victim === 0) {
            if (!capturesOnly) {
              out[count++] = encodeMove(square, target);
            }
          } else if (victim >> 3 === them) {
            out[count++] = encodeMove(square, target);
          }
        }
        continue;
      }

      const diagonal = type !== ROOK;
      const straight = type !== BISHOP;
      for (let index = 0; index < 8; index += 1) {
        const offset = KING_OFFSETS[index];
        const isStraight = offset === -16 || offset === -1 || offset === 1 || offset === 16;
        if (isStraight ? !straight : !diagonal) {
          continue;
        }
        for (let target = square + offset; !(target & 0x88); target += offset) {
          const victim = board[target];
          if (victim === 0) {
            if (!capturesOnly) {
              out[count++] = encodeMove(square, target);
            }
            continue;
          }
          if (victim >> 3 === them) {
            out[count++] = encodeMove(square, target);
          }
          break;
        }
      }
    }

    if (!capturesOnly && this.castling !== 0) {
      count = this.generateCastling(out, count);
    }
    return count;
  }

  /**
   * Plays a pseudo-legal move. Returns false, leaving the position unchanged, when the move would leave the
   * mover's own king in check.
   */
  make(move: Move): boolean {
    const from = move & 127;
    const to = (move >> 7) & 127;
    const promotion = (move >> 14) & 7;
    const flag = move >> 17;
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    const piece = board[from];
    let captured = board[to];
    const height = this.ply;

    this.undoMove[height] = move;
    this.undoCastling[height] = this.castling;
    this.undoEp[height] = this.epSquare;
    this.undoHalfmove[height] = this.halfmoveClock;
    this.undoHashLo[height] = this.hashLo;
    this.undoHashHi[height] = this.hashHi;

    let lo = this.hashLo ^ Z_CASTLE_LO[this.castling] ^ Z_TURN_LO;
    let hi = this.hashHi ^ Z_CASTLE_HI[this.castling] ^ Z_TURN_HI;
    if (this.epSquare !== -1) {
      lo ^= Z_EP_LO[this.epSquare & 7];
      hi ^= Z_EP_HI[this.epSquare & 7];
    }

    board[from] = 0;
    lo ^= Z_PIECE_LO[piece * 128 + from];
    hi ^= Z_PIECE_HI[piece * 128 + from];

    if (flag === FLAG_EN_PASSANT) {
      const victimSquare = us === WHITE ? to - 16 : to + 16;
      captured = board[victimSquare];
      board[victimSquare] = 0;
      lo ^= Z_PIECE_LO[captured * 128 + victimSquare];
      hi ^= Z_PIECE_HI[captured * 128 + victimSquare];
    } else if (captured !== 0) {
      lo ^= Z_PIECE_LO[captured * 128 + to];
      hi ^= Z_PIECE_HI[captured * 128 + to];
    }
    this.undoCaptured[height] = captured;

    const placed = promotion !== 0 ? (us << 3) | promotion : piece;
    board[to] = placed;
    lo ^= Z_PIECE_LO[placed * 128 + to];
    hi ^= Z_PIECE_HI[placed * 128 + to];

    if (flag === FLAG_CASTLE_KING || flag === FLAG_CASTLE_QUEEN) {
      const rookFrom = flag === FLAG_CASTLE_KING ? to + 1 : to - 2;
      const rookTo = flag === FLAG_CASTLE_KING ? to - 1 : to + 1;
      const rook = board[rookFrom];
      board[rookFrom] = 0;
      board[rookTo] = rook;
      lo ^= Z_PIECE_LO[rook * 128 + rookFrom] ^ Z_PIECE_LO[rook * 128 + rookTo];
      hi ^= Z_PIECE_HI[rook * 128 + rookFrom] ^ Z_PIECE_HI[rook * 128 + rookTo];
    }

    if ((piece & 7) === KING) {
      this.kingSquare[us] = to;
    }

    this.epSquare = -1;
    if (flag === FLAG_DOUBLE_PUSH && this.pawnStandsBeside(to, them)) {
      this.epSquare = (from + to) >> 1;
      lo ^= Z_EP_LO[to & 7];
      hi ^= Z_EP_HI[to & 7];
    }

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.hashLo = lo ^ Z_CASTLE_LO[this.castling];
    this.hashHi = hi ^ Z_CASTLE_HI[this.castling];

    this.halfmoveClock = (piece & 7) === PAWN || captured !== 0 ? 0 : this.halfmoveClock + 1;
    if (us === BLACK) {
      this.fullmoveNumber += 1;
    }
    this.turn = them;
    this.ply = height + 1;

    if (this.isSquareAttacked(this.kingSquare[us], them)) {
      this.unmake();
      return false;
    }
    return true;
  }

  /** Takes back the last move made with `make`. */
  unmake(): void {
    const height = this.ply - 1;
    const move = this.undoMove[height];
    const from = move & 127;
    const to = (move >> 7) & 127;
    const promotion = (move >> 14) & 7;
    const flag = move >> 17;
    const board = this.board;
    const us = this.turn ^ 1;
    const captured = this.undoCaptured[height];

    const piece = promotion !== 0 ? (us << 3) | PAWN : board[to];
    board[from] = piece;
    if (flag === FLAG_EN_PASSANT) {
      board[to] = 0;
      board[us === WHITE ? to - 16 : to + 16] = captured;
    } else {
      board[to] = captured;
    }
    if (flag === FLAG_CASTLE_KING || flag === FLAG_CASTLE_QUEEN) {
      const rookFrom = flag === FLAG_CASTLE_KING ? to + 1 : to - 2;
      const rookTo = flag === FLAG_CASTLE_KING ? to - 1 : to + 1;
      board[rookFrom] = board[rookTo];
      board[rookTo] = 0;
    }
    if ((piece & 7) === KING) {
      this.kingSquare[us] = from;
    }

    this.restoreState(height);
    if (us === BLACK) {
      this.fullmoveNumber -= 1;
    }
  }

  /** Passes the turn without moving, for null-move pruning in the search. Must not be used while in check. */
  makeNull(): void {
    const height = this.ply;
    this.undoMove[height] = 0;
    this.undoCaptured[height] = 0;
    this.undoCastling[height] = this.castling;
    this.undoEp[height] = this.epSquare;
    this.undoHalfmove[height] = this.halfmoveClock;
    this.undoHashLo[height] = this.hashLo;
    this.undoHashHi[height] = this.hashHi;

    this.hashLo ^= Z_TURN_LO;
    this.hashHi ^= Z_TURN_HI;
    if (this.epSquare !== -1) {
      this.hashLo ^= Z_EP_LO[this.epSquare & 7];
      this.hashHi ^= Z_EP_HI[this.epSquare & 7];
      this.epSquare = -1;
    }
    this.halfmoveClock += 1;
    this.turn ^= 1;
    this.ply = height + 1;
  }

  unmakeNull(): void {
    this.restoreState(this.ply - 1);
  }

  /** All legal moves for the side to move. */
  legalMoves(): Move[] {
    const pseudo: Move[] = [];
    const count = this.generateMoves(pseudo);
    const legal: Move[] = [];
    for (let index = 0; index < count; index += 1) {
      if (this.make(pseudo[index])) {
        this.unmake();
        legal.push(pseudo[index]);
      }
    }
    return legal;
  }

  /** The legal move written as `uci`, or null when there is none. */
  findMove(uci: string): Move | null {
    if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
      return null;
    }
    return this.legalMoves().find((move) => moveToUci(move) === uci) ?? null;
  }

  /** True when `square` is attacked by any piece of `byColor`. */
  isSquareAttacked(square: number, byColor: number): boolean {
    const board = this.board;

    // A white pawn attacks one rank up, so the attackers of `square` sit one rank below it.
    const pawn = (byColor << 3) | PAWN;
    const pawnRank = byColor === WHITE ? -16 : 16;
    let origin = square + pawnRank - 1;
    if (!(origin & 0x88) && board[origin] === pawn) {
      return true;
    }
    origin = square + pawnRank + 1;
    if (!(origin & 0x88) && board[origin] === pawn) {
      return true;
    }

    const knight = (byColor << 3) | KNIGHT;
    const king = (byColor << 3) | KING;
    for (let index = 0; index < 8; index += 1) {
      origin = square + KNIGHT_OFFSETS[index];
      if (!(origin & 0x88) && board[origin] === knight) {
        return true;
      }
      origin = square + KING_OFFSETS[index];
      if (!(origin & 0x88) && board[origin] === king) {
        return true;
      }
    }

    const queen = (byColor << 3) | QUEEN;
    const bishop = (byColor << 3) | BISHOP;
    const rook = (byColor << 3) | ROOK;
    for (let index = 0; index < 4; index += 1) {
      let offset = BISHOP_OFFSETS[index];
      for (origin = square + offset; !(origin & 0x88); origin += offset) {
        const piece = board[origin];
        if (piece !== 0) {
          if (piece === bishop || piece === queen) {
            return true;
          }
          break;
        }
      }
      offset = ROOK_OFFSETS[index];
      for (origin = square + offset; !(origin & 0x88); origin += offset) {
        const piece = board[origin];
        if (piece !== 0) {
          if (piece === rook || piece === queen) {
            return true;
          }
          break;
        }
      }
    }
    return false;
  }

  /** True when the side to move is in check. */
  inCheck(): boolean {
    return this.isSquareAttacked(this.kingSquare[this.turn], this.turn ^ 1);
  }

  /**
   * How many earlier positions in this object's move history are the same as the current one.
   * Only looks back as far as the last pawn move or capture, because nothing before that can repeat.
   */
  repetitionCount(): number {
    let count = 0;
    const oldest = Math.max(0, this.ply - this.halfmoveClock);
    for (let height = this.ply - 2; height >= oldest; height -= 2) {
      if (this.undoHashLo[height] === this.hashLo && this.undoHashHi[height] === this.hashHi) {
        count += 1;
      }
    }
    return count;
  }

  /** True when neither side could ever give checkmate: bare kings, one minor piece, or only same-coloured bishops. */
  hasInsufficientMaterial(): boolean {
    let knights = 0;
    let lightBishops = 0;
    let darkBishops = 0;
    for (let square = 0; square < 120; square += 1) {
      if (square & 0x88) {
        square += 7;
        continue;
      }
      const type = this.board[square] & 7;
      if (type === PAWN || type === ROOK || type === QUEEN) {
        return false;
      }
      if (type === KNIGHT) {
        knights += 1;
      } else if (type === BISHOP) {
        if (((square >> 4) + (square & 7)) % 2 === 0) {
          darkBishops += 1;
        } else {
          lightBishops += 1;
        }
      }
    }
    if (knights + lightBishops + darkBishops <= 1) {
      return true;
    }
    return knights === 0 && (lightBishops === 0 || darkBishops === 0);
  }

  private generateCastling(out: Move[], start: number): number {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    const home = us === WHITE ? E1 : E8;
    const kingSide = us === WHITE ? CASTLE_WHITE_KING : CASTLE_BLACK_KING;
    const queenSide = us === WHITE ? CASTLE_WHITE_QUEEN : CASTLE_BLACK_QUEEN;
    let count = start;
    if ((this.castling & (kingSide | queenSide)) === 0 || this.isSquareAttacked(home, them)) {
      return count;
    }
    if (
      this.castling & kingSide &&
      board[home + 1] === 0 &&
      board[home + 2] === 0 &&
      !this.isSquareAttacked(home + 1, them) &&
      !this.isSquareAttacked(home + 2, them)
    ) {
      out[count++] = encodeMove(home, home + 2, 0, FLAG_CASTLE_KING);
    }
    if (
      this.castling & queenSide &&
      board[home - 1] === 0 &&
      board[home - 2] === 0 &&
      board[home - 3] === 0 &&
      !this.isSquareAttacked(home - 1, them) &&
      !this.isSquareAttacked(home - 2, them)
    ) {
      out[count++] = encodeMove(home, home - 2, 0, FLAG_CASTLE_QUEEN);
    }
    return count;
  }

  private pawnStandsBeside(square: number, color: number): boolean {
    const pawn = (color << 3) | PAWN;
    return (
      (!((square - 1) & 0x88) && this.board[square - 1] === pawn) ||
      (!((square + 1) & 0x88) && this.board[square + 1] === pawn)
    );
  }

  private restoreState(height: number): void {
    this.castling = this.undoCastling[height];
    this.epSquare = this.undoEp[height];
    this.halfmoveClock = this.undoHalfmove[height];
    this.hashLo = this.undoHashLo[height];
    this.hashHi = this.undoHashHi[height];
    this.turn ^= 1;
    this.ply = height;
  }

  private computeHash(): void {
    let lo = Z_CASTLE_LO[this.castling];
    let hi = Z_CASTLE_HI[this.castling];
    for (let square = 0; square < 120; square += 1) {
      const piece = this.board[square];
      if (!(square & 0x88) && piece !== 0) {
        lo ^= Z_PIECE_LO[piece * 128 + square];
        hi ^= Z_PIECE_HI[piece * 128 + square];
      }
    }
    if (this.epSquare !== -1) {
      lo ^= Z_EP_LO[this.epSquare & 7];
      hi ^= Z_EP_HI[this.epSquare & 7];
    }
    if (this.turn === BLACK) {
      lo ^= Z_TURN_LO;
      hi ^= Z_TURN_HI;
    }
    this.hashLo = lo;
    this.hashHi = hi;
  }
}
