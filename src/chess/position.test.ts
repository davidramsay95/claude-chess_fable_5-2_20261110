import { describe, expect, it } from "vitest";
import { type Move, Position, START_FEN, moveToUci } from "./position";

const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";

const perft = (position: Position, depth: number): number => {
  const moves: Move[] = [];
  const count = position.generateMoves(moves);
  let nodes = 0;
  for (let index = 0; index < count; index += 1) {
    if (!position.make(moves[index])) {
      continue;
    }
    nodes += depth === 1 ? 1 : perft(position, depth - 1);
    position.unmake();
  }
  return nodes;
};

const legalUci = (fen: string): string[] => Position.fromFen(fen).legalMoves().map(moveToUci).sort();

const playAll = (position: Position, moves: readonly string[]): void => {
  for (const uci of moves) {
    const move = position.findMove(uci);
    if (move === null) {
      throw new Error(`Test setup: ${uci} is not legal in ${position.toFen()}`);
    }
    position.make(move);
  }
};

describe("perft", () => {
  it.each([
    [1, 20],
    [2, 400],
    [3, 8902],
    [4, 197281],
  ])("start position depth %i gives %i", (depth, expected) => {
    expect(perft(Position.fromFen(START_FEN), depth)).toBe(expected);
  });

  it.each([
    [1, 48],
    [2, 2039],
    [3, 97862],
  ])("Kiwipete depth %i gives %i", (depth, expected) => {
    expect(perft(Position.fromFen(KIWIPETE), depth)).toBe(expected);
  });

  it.each([
    // Positions 3, 4 and 5 from the chessprogramming perft suite: en passant pins, promotions, castling edge cases.
    ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4, 43238],
    ["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3, 9467],
    ["rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 3, 62379],
  ])("%s depth %i gives %i", (fen, depth, expected) => {
    expect(perft(Position.fromFen(fen), depth)).toBe(expected);
  });

  it("restores the position exactly after make and unmake", () => {
    const position = Position.fromFen(KIWIPETE);
    const before = { fen: position.toFen(), lo: position.hashLo, hi: position.hashHi };
    perft(position, 3);
    expect({ fen: position.toFen(), lo: position.hashLo, hi: position.hashHi }).toEqual(before);
  });
});

describe("FEN", () => {
  it.each([START_FEN, KIWIPETE, "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 12 40"])("round-trips %s", (fen) => {
    expect(Position.fromFen(fen).toFen()).toBe(fen);
  });

  it.each([
    ["", "empty"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1", "short rank"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1", "seven ranks"],
    ["rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "missing king"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1", "bad turn"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQxq - 0 1", "bad castling"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9 0 1", "bad en passant"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - x 1", "bad clock"],
    ["Pnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "pawn on back rank"],
    ["4k3/8/8/8/8/8/8/4KR2 w - - 0 1".replace("4k3", "5k2"), "side not to move in check"],
  ])("rejects %s (%s)", (fen) => {
    expect(() => Position.fromFen(fen)).toThrow();
  });

  it("drops castling rights that the pieces cannot support", () => {
    const position = Position.fromFen("r3k2r/8/8/8/8/8/8/4K2R w KQkq - 0 1");
    expect(position.toFen()).toBe("r3k2r/8/8/8/8/8/8/4K2R w Kkq - 0 1");
  });
});

describe("castling", () => {
  it("allows both sides when the path is clear and safe", () => {
    const moves = legalUci("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(moves).toContain("e1g1");
    expect(moves).toContain("e1c1");
  });

  it("moves the rook as well as the king", () => {
    const position = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    playAll(position, ["e1g1", "e8c8"]);
    expect(position.toFen()).toBe("2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2");
  });

  it("is not allowed out of check", () => {
    const moves = legalUci("r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1");
    expect(moves).not.toContain("e1g1");
    expect(moves).not.toContain("e1c1");
  });

  it("is not allowed through an attacked square", () => {
    // The black rook on f8 covers f1; the queen side is still fine.
    const moves = legalUci("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(moves).not.toContain("e1g1");
    expect(moves).toContain("e1c1");
  });

  it("is not allowed into check", () => {
    const moves = legalUci("4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(moves).not.toContain("e1g1");
  });

  it("is allowed on the queen side when only b1 is attacked", () => {
    const moves = legalUci("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(moves).toContain("e1c1");
  });

  it("is not allowed with a piece in between", () => {
    const moves = legalUci("r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1");
    expect(moves).not.toContain("e1g1");
    expect(moves).not.toContain("e1c1");
  });

  it("is lost after the king moves and after a rook moves or is captured", () => {
    const kingMoved = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    playAll(kingMoved, ["e1e2", "e8e7", "e2e1", "e7e8"]);
    expect(kingMoved.toFen().split(" ")[2]).toBe("-");

    const rookMoved = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    playAll(rookMoved, ["h1g1", "a8b8"]);
    expect(rookMoved.toFen().split(" ")[2]).toBe("Qk");

    const rookCaptured = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    playAll(rookCaptured, ["a1a8"]);
    expect(rookCaptured.toFen().split(" ")[2]).toBe("Kk");
  });
});

describe("en passant", () => {
  it("is available immediately after a double push and removes the pawn", () => {
    const position = Position.fromFen("4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1");
    playAll(position, ["e2e4"]);
    expect(position.toFen()).toBe("4k3/8/8/8/4Pp2/8/8/4K3 b - e3 0 1");
    playAll(position, ["f4e3"]);
    expect(position.toFen()).toBe("4k3/8/8/8/8/4p3/8/4K3 w - - 0 2");
  });

  it("expires after one move", () => {
    const position = Position.fromFen("4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1");
    playAll(position, ["e2e4", "e8e7", "e1e2"]);
    expect(position.legalMoves().map(moveToUci)).not.toContain("f4e3");
  });

  it("is illegal when it would expose the king along the rank", () => {
    const moves = legalUci("8/8/8/8/k2Pp2Q/8/8/4K3 b - d3 0 1");
    expect(moves).not.toContain("e4d3");
  });
});

describe("promotion", () => {
  it("offers all four pieces, by push and by capture", () => {
    const moves = legalUci("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    expect(moves).toEqual(expect.arrayContaining(["a7a8q", "a7a8r", "a7a8b", "a7a8n", "a7b8q", "a7b8r", "a7b8b", "a7b8n"]));
  });

  it("places the chosen piece", () => {
    const position = Position.fromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    playAll(position, ["a7a8n"]);
    expect(position.toFen()).toBe("N3k3/8/8/8/8/8/8/4K3 b - - 0 1");
  });

  it("rejects a promotion move without a piece letter", () => {
    expect(Position.fromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1").findMove("a7a8")).toBeNull();
  });
});

describe("check, checkmate and stalemate", () => {
  it("detects check and only allows moves that answer it", () => {
    const position = Position.fromFen("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1");
    expect(position.inCheck()).toBe(true);
    expect(position.legalMoves().map(moveToUci).sort()).toEqual(["e1d1", "e1e2", "e1f1"]);
  });

  it("has no legal moves and is in check after fool's mate", () => {
    const position = Position.fromFen(START_FEN);
    playAll(position, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(position.inCheck()).toBe(true);
    expect(position.legalMoves()).toHaveLength(0);
  });

  it("has no legal moves and is not in check in a stalemate", () => {
    const position = Position.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(position.inCheck()).toBe(false);
    expect(position.legalMoves()).toHaveLength(0);
  });

  it("does not let a pinned piece move off the pin line", () => {
    const moves = legalUci("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1");
    expect(moves.filter((uci) => uci.startsWith("e2"))).toEqual([]);
  });
});

describe("clocks and repetition", () => {
  it("counts half-moves and resets on pawn moves and captures", () => {
    const position = Position.fromFen(START_FEN);
    playAll(position, ["g1f3", "g8f6"]);
    expect(position.halfmoveClock).toBe(2);
    playAll(position, ["e2e4"]);
    expect(position.halfmoveClock).toBe(0);
    playAll(position, ["f6e4"]);
    expect(position.halfmoveClock).toBe(0);
    expect(position.fullmoveNumber).toBe(3);
  });

  it("counts earlier occurrences of the current position", () => {
    const position = Position.fromFen(START_FEN);
    expect(position.repetitionCount()).toBe(0);
    playAll(position, ["g1f3", "g8f6", "f3g1", "f6g8"]);
    expect(position.repetitionCount()).toBe(1);
    playAll(position, ["g1f3", "g8f6", "f3g1", "f6g8"]);
    expect(position.repetitionCount()).toBe(2);
  });

  it("gives the same hash for the same position reached by different move orders", () => {
    const first = Position.fromFen(START_FEN);
    playAll(first, ["g1f3", "g8f6", "b1c3"]);
    const second = Position.fromFen(START_FEN);
    playAll(second, ["b1c3", "g8f6", "g1f3"]);
    expect([first.hashLo, first.hashHi]).toEqual([second.hashLo, second.hashHi]);
    expect([first.hashLo, first.hashHi]).toEqual(
      ((): number[] => {
        const fresh = Position.fromFen(first.toFen());
        return [fresh.hashLo, fresh.hashHi];
      })(),
    );
  });

  it("supports a null move that only passes the turn", () => {
    const position = Position.fromFen(KIWIPETE);
    const before = { fen: position.toFen(), lo: position.hashLo, hi: position.hashHi };
    position.makeNull();
    expect(position.turn).toBe(1);
    expect(position.hashLo === before.lo && position.hashHi === before.hi).toBe(false);
    position.unmakeNull();
    expect({ fen: position.toFen(), lo: position.hashLo, hi: position.hashHi }).toEqual(before);
  });
});

describe("insufficient material", () => {
  it.each([
    ["4k3/8/8/8/8/8/8/4K3 w - - 0 1", true, "bare kings"],
    ["4k3/8/8/8/8/8/8/4KN2 w - - 0 1", true, "king and knight"],
    ["4k3/8/8/8/8/8/8/4KB2 w - - 0 1", true, "king and bishop"],
    ["2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1", true, "bishops on the same colour"],
    ["3bk3/8/8/8/8/8/8/4KB2 w - - 0 1", false, "bishops on opposite colours"],
    ["4k3/8/8/8/8/8/8/3NKN2 w - - 0 1", false, "two knights"],
    ["4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", false, "a pawn"],
    ["4k3/8/8/8/8/8/8/4KR2 w - - 0 1", false, "a rook"],
  ])("%s is %s (%s)", (fen, expected) => {
    expect(Position.fromFen(fen).hasInsufficientMaterial()).toBe(expected);
  });
});
