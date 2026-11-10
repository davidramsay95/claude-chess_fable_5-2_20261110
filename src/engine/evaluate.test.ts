import { describe, expect, it } from "vitest";
import { BLACK, Position, START_FEN, WHITE } from "../chess/position";
import { evaluate, hasNonPawnMaterial } from "./evaluate";

const swapCase = (text: string): string =>
  [...text].map((letter) => (letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase())).join("");

/** The same position seen from the other side: ranks flipped, colours swapped, other side to move. */
const mirrorFen = (fen: string): string => {
  const [placement, turn, castling, enPassant, halfmove, fullmove] = fen.split(" ");
  const mirroredPlacement = placement.split("/").reverse().map(swapCase).join("/");
  const swappedCastling = castling === "-" ? "-" : swapCase(castling);
  const mirroredCastling =
    swappedCastling === "-" ? "-" : [..."KQkq"].filter((letter) => swappedCastling.includes(letter)).join("");
  const mirroredEnPassant = enPassant === "-" ? "-" : `${enPassant[0]}${9 - Number(enPassant[1])}`;
  return `${mirroredPlacement} ${turn === "w" ? "b" : "w"} ${mirroredCastling} ${mirroredEnPassant} ${halfmove} ${fullmove}`;
};

const score = (fen: string): number => evaluate(Position.fromFen(fen));

const SYMMETRY_FENS: readonly string[] = [
  START_FEN,
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R b KQ - 3 8",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1",
  "8/8/8/3k4/8/8/8/KQ6 w - - 0 1",
  "8/8/4k3/8/2B5/5N2/8/K7 b - - 0 1",
  "2kr3r/ppp2ppp/2n5/2b1p3/4P1b1/2NP1N2/PPP2PPP/R1B2RK1 w - - 0 10",
  "8/5pk1/6p1/P7/8/6P1/5PK1/8 b - - 0 40",
  "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
  "r4rk1/1pp2ppp/p1np1q2/2b1p3/2B1P1b1/2PP1N2/PP1N1PPP/R2Q1RK1 w - - 0 11",
  "6k1/R7/6K1/8/8/8/7r/8 b - - 0 1",
];

describe("evaluate", () => {
  it.each(SYMMETRY_FENS)("scores %s the same as its colour-swapped mirror", (fen) => {
    expect(score(mirrorFen(fen))).toBe(score(fen));
  });

  it("gives both sides the same score from the start position", () => {
    const white = score(START_FEN);
    const black = score(START_FEN.replace(" w ", " b "));
    expect(white).toBe(black);
    expect(Math.abs(white)).toBeLessThan(40);
  });

  it("is from the point of view of the side to move", () => {
    const whiteToMove = score("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    const blackToMove = score("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");
    expect(whiteToMove).toBeGreaterThan(800);
    expect(blackToMove).toBeLessThan(-800);
  });

  it("orders the pieces by value", () => {
    const withPiece = (letter: string): number => score(`4k3/pppppppp/8/8/8/8/PPPPPPPP/3${letter}K3 w - - 0 1`);
    expect(withPiece("Q")).toBeGreaterThan(withPiece("R"));
    expect(withPiece("R")).toBeGreaterThan(withPiece("B"));
    expect(withPiece("B")).toBeGreaterThan(200);
    expect(withPiece("N")).toBeGreaterThan(200);
  });

  it("scores dead-drawn material as zero", () => {
    expect(score("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(0);
    expect(score("4k3/8/8/8/8/8/8/3BK3 w - - 0 1")).toBe(0);
    expect(score("4k3/8/8/8/8/8/8/3NK3 b - - 0 1")).toBe(0);
    expect(score("4kb2/8/8/8/8/8/8/4KB2 w - - 0 1")).not.toBe(0);
  });

  it("does not think a lone minor piece is winning", () => {
    expect(Math.abs(score("4k3/4p3/8/8/8/8/8/3BK3 w - - 0 1"))).toBeLessThan(150);
    expect(Math.abs(score("4k3/8/8/8/8/8/8/2NNK3 w - - 0 1"))).toBeLessThan(150);
  });

  it("prefers the defending king on the edge and the kings close together in a won ending", () => {
    const centre = score("8/8/8/3k4/8/8/8/KQ6 w - - 0 1");
    const edge = score("3k4/8/8/8/8/8/8/KQ6 w - - 0 1");
    const edgeAndClose = score("3k4/8/3K4/8/8/8/8/1Q6 w - - 0 1");
    expect(edge).toBeGreaterThan(centre);
    expect(edgeAndClose).toBeGreaterThan(edge);
  });

  it("drives the king to the bishop's corner with bishop and knight", () => {
    // The bishop on c4 is light-squared, so a8 and h1 are the mating corners.
    const rightCorner = score("k7/8/1K6/8/2B5/5N2/8/8 w - - 0 1");
    const wrongCorner = score("7k/8/6K1/8/2B5/5N2/8/8 w - - 0 1");
    expect(rightCorner).toBeGreaterThan(wrongCorner);
  });

  it("rewards a passed pawn more the further it has advanced", () => {
    const far = score("4k3/8/1P6/8/8/8/8/4K3 w - - 0 1");
    const near = score("4k3/8/8/8/8/1P6/8/4K3 w - - 0 1");
    expect(far).toBeGreaterThan(near);
  });

  it("penalises doubled and isolated pawns", () => {
    const healthy = score("4k3/8/8/8/8/8/1PP5/4K3 w - - 0 1");
    const doubled = score("4k3/8/8/8/8/1P6/1P6/4K3 w - - 0 1");
    const isolated = score("4k3/8/8/8/8/8/1P1P4/4K3 w - - 0 1");
    expect(healthy).toBeGreaterThan(doubled);
    expect(healthy).toBeGreaterThan(isolated);
  });

  it("likes a rook on an open file and the bishop pair", () => {
    const openFile = score("4k3/pp3ppp/8/8/8/8/PP3PPP/3RK3 w - - 0 1");
    const closedFile = score("4k3/pp3ppp/8/8/8/8/PP3PPP/1R2K3 w - - 0 1");
    expect(openFile).toBeGreaterThan(closedFile);
    const pair = score("4k3/pppppppp/8/8/8/8/PPPPPPPP/2B1KB2 w - - 0 1");
    const bishopAndKnight = score("4k3/pppppppp/8/8/8/8/PPPPPPPP/2B1K1N1 w - - 0 1");
    expect(pair).toBeGreaterThan(bishopAndKnight);
  });

  it("does not change the position", () => {
    const position = Position.fromFen(SYMMETRY_FENS[1]);
    const before = position.toFen();
    evaluate(position);
    expect(position.toFen()).toBe(before);
  });
});

describe("hasNonPawnMaterial", () => {
  it("is true only for a side that owns a piece besides king and pawns", () => {
    const position = Position.fromFen("4k3/pppp4/8/8/8/8/PPPP4/3RK3 w - - 0 1");
    expect(hasNonPawnMaterial(position, WHITE)).toBe(true);
    expect(hasNonPawnMaterial(position, BLACK)).toBe(false);
  });
});
