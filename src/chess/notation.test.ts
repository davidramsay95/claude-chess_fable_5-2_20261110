import { describe, expect, it } from "vitest";
import { moveToSan } from "./notation";
import { Position, START_FEN } from "./position";

const san = (fen: string, uci: string): string => {
  const position = Position.fromFen(fen);
  const move = position.findMove(uci);
  if (move === null) {
    throw new Error(`Test setup: ${uci} is not legal`);
  }
  const before = position.toFen();
  const text = moveToSan(position, move);
  expect(position.toFen()).toBe(before);
  return text;
};

describe("moveToSan", () => {
  it.each([
    [START_FEN, "e2e4", "e4"],
    [START_FEN, "g1f3", "Nf3"],
    ["rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "e4d5", "exd5"],
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1", "O-O"],
    ["r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", "e8c8", "O-O-O"],
    ["8/P6k/8/8/8/8/8/4K3 w - - 0 1", "a7a8q", "a8=Q"],
    ["1n5k/P7/8/8/8/8/8/4K3 w - - 0 1", "a7b8n", "axb8=N"],
    ["4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6", "exd6"],
    ["4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1", "b1d2", "Nbd2"],
    ["4k3/8/8/8/R7/8/8/R3K3 w - - 0 1", "a1a3", "R1a3"],
    ["8/7k/8/8/Q5Q1/8/8/Q3K3 w - - 0 1", "a4d1", "Qa4d1"],
    ["4k3/8/8/8/8/8/3q4/R3K3 w - - 0 1", "e1d2", "Kxd2"],
    ["4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8", "Ra8+"],
    ["6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8", "Ra8#"],
  ])("%s %s is %s", (fen, uci, expected) => {
    expect(san(fen, uci)).toBe(expected);
  });

  it("does not disambiguate against a pinned piece that cannot make the move", () => {
    // The knight on e2 is pinned to the king by the rook on e8, so only the b1 knight can go to c3.
    expect(san("4r1k1/8/8/8/8/8/4N3/1N2K3 w - - 0 1", "b1c3")).toBe("Nc3");
  });
});
