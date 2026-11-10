import { describe, expect, it } from "vitest";
import { START_FEN } from "../chess/position";
import { Game, type GameState, StateError } from "./game";

const FOOLS_MATE: GameState = {
  version: 1,
  startFen: START_FEN,
  playerColor: "white",
  difficulty: "medium",
  moves: ["f2f3", "e7e5", "g2g4", "d8h4"],
  resigned: false,
};

const stateWith = (overrides: Record<string, unknown>): Record<string, unknown> => ({ ...FOOLS_MATE, ...overrides });

const gameFrom = (startFen: string, moves: string[] = []): Game => Game.fromState(stateWith({ startFen, moves }));

describe("a new game", () => {
  it("starts from the standard position with nothing played", () => {
    const game = Game.create("black", "hard");
    expect(game.toState()).toEqual({
      version: 1,
      startFen: START_FEN,
      playerColor: "black",
      difficulty: "hard",
      moves: [],
      resigned: false,
    });
    expect(game.outcome).toEqual({ result: "*", reason: null });
    expect(game.isHumanTurn()).toBe(false);
  });

  it("records every move as UCI and SAN", () => {
    const game = Game.create("white", "easy");
    expect(game.playUci("e2e4")).toBe(true);
    expect(game.playUci("g8f6")).toBe(true);
    expect(game.toState().moves).toEqual(["e2e4", "g8f6"]);
    expect(game.plies.map((ply) => ply.san)).toEqual(["e4", "Nf6"]);
    expect(game.isHumanTurn()).toBe(true);
  });

  it("refuses an illegal move and stays unchanged", () => {
    const game = Game.create("white", "easy");
    expect(game.playUci("e2e5")).toBe(false);
    expect(game.toState().moves).toEqual([]);
  });

  it("gives the position after any number of half-moves", () => {
    const game = Game.fromState(FOOLS_MATE);
    expect(game.fenAt(0)).toBe(START_FEN);
    expect(game.fenAt(1)).toBe("rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1");
    expect(game.fenAt(4)).toBe(game.position.toFen());
  });

  it("records what each move captured, including en passant", () => {
    const game = gameFrom("4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1", ["e2e4", "f4e3"]);
    expect(game.plies.map((ply) => ply.captured)).toEqual([0, 1]);
  });
});

describe("outcomes", () => {
  it("is a win for black after fool's mate", () => {
    const game = Game.fromState(FOOLS_MATE);
    expect(game.outcome).toEqual({ result: "0-1", reason: "checkmate" });
    expect(game.playUci("a2a3")).toBe(false);
  });

  it("is a win for white after scholar's mate", () => {
    const game = gameFrom(START_FEN, ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
    expect(game.outcome).toEqual({ result: "1-0", reason: "checkmate" });
  });

  it("is a draw by stalemate", () => {
    const game = gameFrom("7k/8/6K1/8/8/8/5Q2/8 w - - 0 1", ["f2f7"]);
    expect(game.outcome).toEqual({ result: "1/2-1/2", reason: "stalemate" });
  });

  it("is a draw when a position occurs for the third time", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const twice = gameFrom(START_FEN, [...shuffle, "g1f3", "g8f6", "f3g1"]);
    expect(twice.outcome.result).toBe("*");
    const thrice = gameFrom(START_FEN, [...shuffle, ...shuffle]);
    expect(thrice.outcome).toEqual({ result: "1/2-1/2", reason: "threefold" });
  });

  it("does not count positions with different castling rights as a repetition", () => {
    // The first occurrence of the position still has castling rights; the later ones do not.
    const game = gameFrom("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", [
      "e1e2", "e8e7", "e2e1", "e7e8",
      "e1e2", "e8e7", "e2e1", "e7e8",
    ]);
    expect(game.outcome.result).toBe("*");
  });

  it("is a draw after fifty moves without a pawn move or capture", () => {
    const before = gameFrom("4k3/8/8/8/8/8/8/R3K3 w - - 98 80", ["a1a2"]);
    expect(before.outcome.result).toBe("*");
    const after = gameFrom("4k3/8/8/8/8/8/8/R3K3 w - - 98 80", ["a1a2", "e8d8"]);
    expect(after.outcome).toEqual({ result: "1/2-1/2", reason: "fifty-move" });
  });

  it("prefers checkmate over the fifty-move rule", () => {
    const game = gameFrom("6k1/5ppp/8/8/8/8/8/R3K3 w - - 99 80", ["a1a8"]);
    expect(game.outcome).toEqual({ result: "1-0", reason: "checkmate" });
  });

  it("is a draw when neither side can mate", () => {
    const game = gameFrom("4k3/8/8/8/8/8/3p4/4K3 w - - 0 1", ["e1d2"]);
    expect(game.outcome).toEqual({ result: "1/2-1/2", reason: "insufficient" });
  });

  it("is a loss for the human after resigning", () => {
    const asWhite = Game.create("white", "easy");
    asWhite.resign();
    expect(asWhite.outcome).toEqual({ result: "0-1", reason: "resignation" });
    expect(asWhite.toState().resigned).toBe(true);
    expect(asWhite.playUci("e2e4")).toBe(false);

    const asBlack = Game.create("black", "easy");
    asBlack.resign();
    expect(asBlack.outcome).toEqual({ result: "1-0", reason: "resignation" });
  });

  it("ignores a resignation flag on a game that already ended on the board", () => {
    const game = Game.fromState(stateWith({ resigned: true, playerColor: "black" }));
    expect(game.outcome).toEqual({ result: "0-1", reason: "checkmate" });
  });
});

describe("export and import", () => {
  it("gives an identical state after a round trip through JSON", () => {
    const game = Game.create("black", "expert");
    for (const uci of ["e2e4", "c7c5", "g1f3", "d7d6", "f1b5", "c8d7", "e1g1"]) {
      expect(game.playUci(uci)).toBe(true);
    }
    const exported = game.toState();
    const restored = Game.fromState(JSON.parse(JSON.stringify(exported)));
    expect(restored.toState()).toEqual(exported);
    expect(restored.position.toFen()).toBe(game.position.toFen());
    expect(restored.plies.map((ply) => ply.san)).toEqual(game.plies.map((ply) => ply.san));
  });

  it("keeps the summary used by the save bridge", () => {
    expect(Game.fromState(FOOLS_MATE).summary()).toEqual({ result: "0-1", moveCount: 4 });
    expect(Game.create("white", "easy").summary()).toEqual({ result: "*", moveCount: 0 });
  });

  it("accepts a state whose game continued past an unclaimed draw", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const game = gameFrom(START_FEN, [...shuffle, ...shuffle, "e2e4"]);
    expect(game.outcome.result).toBe("*");
    expect(game.plies).toHaveLength(9);
  });

  it.each([
    [null, /object/i],
    ["{}", /object/i],
    [[], /object/i],
    [stateWith({ version: 2 }), /version/i],
    [stateWith({ startFen: "not a fen" }), /startFen/],
    [stateWith({ startFen: 5 }), /startFen/],
    [stateWith({ playerColor: "green" }), /playerColor/],
    [stateWith({ difficulty: "impossible" }), /difficulty/],
    [stateWith({ moves: "e2e4" }), /moves/],
    [stateWith({ moves: ["e2e4", 7] }), /Move 2/],
    [stateWith({ resigned: "no" }), /resigned/],
    [stateWith({ moves: ["f2f3", "e7e5", "g2g5"] }), /^Move 3 \(g2g5\) is not legal$/],
    [stateWith({ moves: [...FOOLS_MATE.moves, "a2a3"] }), /^Move 5 \(a2a3\) is not legal$/],
    [stateWith({ moves: ["e2e4", "e7e8q"] }), /Move 2/],
  ])("rejects invalid state %#", (value, message) => {
    expect(() => Game.fromState(value)).toThrow(StateError);
    expect(() => Game.fromState(value)).toThrow(message);
  });
});
