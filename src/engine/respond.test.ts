import { describe, expect, it } from "vitest";
import { Position, START_FEN } from "../chess/position";
import { DIFFICULTIES } from "../game/types";
import { respond } from "./respond";

describe("respond", () => {
  it.each(DIFFICULTIES)("answers with a legal move at %s after replaying the game", (difficulty) => {
    const moves = ["e2e4", "e7e5", "g1f3"];
    const response = respond({ id: 7, startFen: START_FEN, moves, difficulty });
    expect(response.id).toBe(7);
    expect(response.error).toBeUndefined();

    const position = Position.fromFen(START_FEN);
    moves.forEach((uci) => position.make(position.findMove(uci) ?? 0));
    expect(position.findMove(response.move ?? "")).not.toBeNull();
  });

  it("answers null when the side to move has been checkmated", () => {
    const response = respond({ id: 1, startFen: START_FEN, moves: ["f2f3", "e7e5", "g2g4", "d8h4"], difficulty: "easy" });
    expect(response).toEqual({ id: 1, move: null });
  });

  it("reports an error instead of throwing when the game cannot be replayed", () => {
    expect(respond({ id: 2, startFen: START_FEN, moves: ["e2e5"], difficulty: "easy" })).toEqual({
      id: 2,
      move: null,
      error: "Move 1 (e2e5) is not legal",
    });
    expect(respond({ id: 3, startFen: "nonsense", moves: [], difficulty: "easy" }).error).toMatch(/FEN/);
  });
});
