import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, pieceColor, pieceType } from "../chess/position";

/**
 * Piece artwork, drawn by hand as SVG paths on a 100 x 100 canvas. Every piece stands on the same plinth so the
 * set reads as one family. `f` shapes take the piece's body colour, `d` shapes are details in the contrast colour.
 */
const PLINTH = '<path class="f" d="M24 89h52a4 4 0 0 0 4-4v-3a6 6 0 0 0-6-6H26a6 6 0 0 0-6 6v3a4 4 0 0 0 4 4z"/>';

const ART: Record<number, string> = {
  [PAWN]:
    '<path class="f" d="M41 44c1 12-9 20-11 32h40c-2-12-12-20-11-32z"/>' +
    '<circle class="f" cx="50" cy="31" r="13"/>' +
    '<path class="f" d="M38 42h24a3 3 0 0 1 0 6H38a3 3 0 0 1 0-6z"/>',
  [KNIGHT]:
    '<path class="f" d="M30 76C31 59 45 53 43 42l-9 6c-4 3-10 2-12-3-1-3 0-5 3-8l14-16 1-11 9 8c16 2 26 17 24 36-1 9-3 16-3 22z"/>' +
    '<path class="d line" d="M54 25c9 6 13 17 11 30"/>' +
    '<circle class="d dot" cx="37" cy="30" r="2.6"/>',
  [BISHOP]:
    '<path class="f" d="M40 64c0 5-8 7-10 12h40c-2-5-10-7-10-12z"/>' +
    '<path class="f" d="M50 16c11 11 16 21 16 29 0 10-7 17-16 17s-16-7-16-17c0-8 5-18 16-29z"/>' +
    '<circle class="f" cx="50" cy="12" r="5"/>' +
    '<path class="f" d="M37 60h26a3 3 0 0 1 0 6H37a3 3 0 0 1 0-6z"/>' +
    '<path class="d line" d="M56 28l-9 13"/>',
  [ROOK]:
    '<path class="f" d="M35 38l-5 38h40l-5-38z"/>' +
    '<path class="f" d="M26 15h11v8h7v-8h12v8h7v-8h11v19a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4z"/>' +
    '<path class="d line" d="M35 48h30"/>',
  [QUEEN]:
    '<path class="f" d="M30 76L18 37l13 15 3-25 10 23 6-27 6 27 10-23 3 25 13-15-12 39z"/>' +
    '<circle class="f" cx="18" cy="33" r="4.6"/><circle class="f" cx="34" cy="23" r="4.6"/>' +
    '<circle class="f" cx="50" cy="19" r="4.6"/><circle class="f" cx="66" cy="23" r="4.6"/>' +
    '<circle class="f" cx="82" cy="33" r="4.6"/>' +
    '<path class="d line" d="M29 65h42"/>',
  [KING]:
    '<path class="f" d="M46 6h8v8h8v8h-8v14h-8V22h-8v-8h8z"/>' +
    '<path class="f" d="M30 76c-8-13-10-25-3-33s19-6 23 4c4-10 16-12 23-4s5 20-3 33z"/>' +
    '<path class="d line" d="M29 66h42"/>',
};

/** Inline SVG markup for a piece code (`color << 3 | type`). */
export const pieceSvg = (piece: number): string =>
  `<svg class="art ${pieceColor(piece) === BLACK ? "b" : "w"}" viewBox="0 0 100 100" aria-hidden="true">${ART[pieceType(piece)]}${PLINTH}</svg>`;

const PIECE_NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];

export const pieceName = (piece: number): string =>
  `${pieceColor(piece) === BLACK ? "black" : "white"} ${PIECE_NAMES[pieceType(piece)]}`;
