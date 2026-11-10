import {
  FLAG_CASTLE_KING,
  FLAG_CASTLE_QUEEN,
  FLAG_EN_PASSANT,
  KING,
  type Move,
  PAWN,
  type Position,
  moveFlag,
  moveFrom,
  movePromotion,
  moveTo,
  pieceType,
  squareName,
} from "./position";

const PIECE_SAN = ["", "", "N", "B", "R", "Q", "K"];

/**
 * Standard algebraic notation for a legal move in `position`, including `+` and `#`.
 * The position is left as it was found.
 */
export const moveToSan = (position: Position, move: Move): string => {
  const from = moveFrom(move);
  const to = moveTo(move);
  const flag = moveFlag(move);
  const type = pieceType(position.board[from]);
  let text: string;

  if (flag === FLAG_CASTLE_KING) {
    text = "O-O";
  } else if (flag === FLAG_CASTLE_QUEEN) {
    text = "O-O-O";
  } else {
    const isCapture = position.board[to] !== 0 || flag === FLAG_EN_PASSANT;
    const target = squareName(to);
    if (type === PAWN) {
      const promotion = movePromotion(move);
      text = `${isCapture ? `${squareName(from)[0]}x` : ""}${target}${promotion !== 0 ? `=${PIECE_SAN[promotion]}` : ""}`;
    } else {
      text = `${PIECE_SAN[type]}${type === KING ? "" : disambiguation(position, move)}${isCapture ? "x" : ""}${target}`;
    }
  }

  position.make(move);
  if (position.inCheck()) {
    text += position.legalMoves().length === 0 ? "#" : "+";
  }
  position.unmake();
  return text;
};

/** The file, rank or full square needed to tell this move apart from the same piece type moving to the same square. */
const disambiguation = (position: Position, move: Move): string => {
  const from = moveFrom(move);
  const to = moveTo(move);
  const piece = position.board[from];
  const rivals = position
    .legalMoves()
    .filter((other) => moveTo(other) === to && moveFrom(other) !== from && position.board[moveFrom(other)] === piece)
    .map(moveFrom);
  if (rivals.length === 0) {
    return "";
  }
  const name = squareName(from);
  if (rivals.every((rival) => squareName(rival)[0] !== name[0])) {
    return name[0];
  }
  if (rivals.every((rival) => squareName(rival)[1] !== name[1])) {
    return name[1];
  }
  return name;
};
