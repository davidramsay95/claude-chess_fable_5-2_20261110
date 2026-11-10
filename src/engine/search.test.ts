import { beforeEach, describe, expect, it } from "vitest";
import { type Move, Position, START_FEN, moveToUci } from "../chess/position";
import { DIFFICULTIES, type Difficulty } from "../game/types";
import { LEVEL_SETTINGS, MATE_SCORE, type SearchOptions, chooseMove, clearSearchTables } from "./search";

const CHECKMATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
const STALEMATED = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
const MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
const MATE_IN_TWO = "8/4k3/R7/1R6/8/8/8/6K1 w - - 0 1";
const MATE_IN_THREE = "8/8/6k1/R7/1R6/8/8/2K5 w - - 0 1";
const HANGING_QUEEN = "4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1";
const MIDDLEGAME = "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R b KQ - 3 8";
const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
const ROOK_ENDING = "8/5pk1/6p1/P7/8/6P1/r4PK1/R7 w - - 0 40";
const PAWN_ENDING = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";

/** A clock that advances a fixed amount per reading, so a search does a fixed amount of work on any machine. */
const tickingClock = (millisecondsPerRead: number): (() => number) => {
  let time = 0;
  return (): number => {
    time += millisecondsPerRead;
    return time;
  };
};

/** Small deterministic generator so tests that involve randomness always see the same sequence. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const fastOptions = (seed = 1): SearchOptions => ({ now: tickingClock(4), random: seededRandom(seed) });

const isLegal = (position: Position, move: Move | null): boolean => move !== null && position.legalMoves().includes(move);

/** True when the side to move can force checkmate within `moves` of its own moves. Brute force, engine independent. */
const canForceMate = (position: Position, moves: number): boolean => {
  for (const move of position.legalMoves()) {
    position.make(move);
    const forced = everyReplyLoses(position, moves - 1);
    position.unmake();
    if (forced) {
      return true;
    }
  }
  return false;
};

const everyReplyLoses = (position: Position, movesLeft: number): boolean => {
  const replies = position.legalMoves();
  if (replies.length === 0) {
    return position.inCheck();
  }
  if (movesLeft === 0) {
    return false;
  }
  for (const reply of replies) {
    position.make(reply);
    const forced = canForceMate(position, movesLeft);
    position.unmake();
    if (!forced) {
      return false;
    }
  }
  return true;
};

beforeEach(() => {
  clearSearchTables();
});

describe("level settings", () => {
  it("describes every difficulty with budgets that grow with strength", () => {
    for (const difficulty of DIFFICULTIES) {
      expect(LEVEL_SETTINGS[difficulty].maxDepth).toBeGreaterThan(0);
      expect(LEVEL_SETTINGS[difficulty].timeBudgetMs).toBeLessThanOrEqual(3000);
    }
    expect(LEVEL_SETTINGS.easy.maxDepth).toBeLessThan(LEVEL_SETTINGS.medium.maxDepth);
    expect(LEVEL_SETTINGS.medium.maxDepth).toBeLessThan(LEVEL_SETTINGS.hard.maxDepth);
    expect(LEVEL_SETTINGS.hard.maxDepth).toBeLessThan(LEVEL_SETTINGS.expert.maxDepth);
    expect(LEVEL_SETTINGS.hard.timeBudgetMs).toBeLessThan(LEVEL_SETTINGS.expert.timeBudgetMs);
    expect(LEVEL_SETTINGS.expert.noiseCentipawns).toBe(0);
    expect(LEVEL_SETTINGS.expert.blunderChance).toBe(0);
  });
});

describe("chooseMove with no legal moves", () => {
  it.each(DIFFICULTIES)("returns null when %s is checkmated", (difficulty) => {
    const result = chooseMove(Position.fromFen(CHECKMATED), difficulty, fastOptions());
    expect(result.move).toBeNull();
    expect(result.score).toBeLessThan(-MATE_SCORE + 100);
  });

  it.each(DIFFICULTIES)("returns null when %s is stalemated", (difficulty) => {
    const result = chooseMove(Position.fromFen(STALEMATED), difficulty, fastOptions());
    expect(result.move).toBeNull();
    expect(result.score).toBe(0);
  });
});

describe("chooseMove tactics", () => {
  it.each(["medium", "hard", "expert"] as const)("%s plays mate in one", (difficulty) => {
    const result = chooseMove(Position.fromFen(MATE_IN_ONE), difficulty, fastOptions());
    expect(result.move === null ? "" : moveToUci(result.move)).toBe("d1d8");
    expect(result.score).toBe(MATE_SCORE - 1);
  });

  it("easy plays mate in one when it is not having a careless moment", () => {
    const result = chooseMove(Position.fromFen(MATE_IN_ONE), "easy", { now: tickingClock(1), random: (): number => 0.99 });
    expect(result.move === null ? "" : moveToUci(result.move)).toBe("d1d8");
  });

  it.each(["hard", "expert"] as const)("%s finds a mate in two", (difficulty) => {
    const position = Position.fromFen(MATE_IN_TWO);
    expect(canForceMate(position, 1)).toBe(false);
    const result = chooseMove(position, difficulty, fastOptions());
    expect(result.score).toBe(MATE_SCORE - 3);
    expect(isLegal(position, result.move)).toBe(true);
    position.make(result.move ?? 0);
    expect(everyReplyLoses(position, 1)).toBe(true);
  });

  it.each(["hard", "expert"] as const)("%s finds a mate in three", (difficulty) => {
    const position = Position.fromFen(MATE_IN_THREE);
    expect(canForceMate(position, 2)).toBe(false);
    const result = chooseMove(position, difficulty, fastOptions());
    expect(result.score).toBe(MATE_SCORE - 5);
    expect(isLegal(position, result.move)).toBe(true);
    position.make(result.move ?? 0);
    expect(everyReplyLoses(position, 2)).toBe(true);
  });

  it("expert stops as soon as it has found a forced mate", () => {
    const result = chooseMove(Position.fromFen(MATE_IN_THREE), "expert", fastOptions());
    expect(result.depth).toBeLessThan(12);
  });

  it.each(["medium", "hard", "expert"] as const)("%s takes a hanging queen", (difficulty) => {
    const result = chooseMove(Position.fromFen(HANGING_QUEEN), difficulty, fastOptions());
    expect(result.move === null ? "" : moveToUci(result.move)).toBe("d2d5");
  });

  it("easy takes a hanging queen nearly every time", () => {
    let taken = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const result = chooseMove(Position.fromFen(HANGING_QUEEN), "easy", fastOptions(seed));
      if (result.move !== null && moveToUci(result.move) === "d2d5") {
        taken += 1;
      }
    }
    expect(taken).toBeGreaterThanOrEqual(27);
  });

  it("easy varies its opening moves", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = chooseMove(Position.fromFen(START_FEN), "easy", fastOptions(seed));
      seen.add(result.move === null ? "" : moveToUci(result.move));
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it.each(["medium", "hard", "expert"] as const)("%s does not stalemate a lone king when a queen up", (difficulty) => {
    // Qf7 here would be stalemate; Qf8 is mate.
    const position = Position.fromFen("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1");
    const result = chooseMove(position, difficulty, fastOptions());
    position.make(result.move ?? 0);
    expect(position.legalMoves().length === 0 && !position.inCheck()).toBe(false);
    expect(result.score).toBe(MATE_SCORE - 1);
  });

  it.each([
    ["queen", "8/8/8/3k4/8/8/8/KQ6 w - - 0 1"],
    ["rook", "8/8/8/3k4/8/8/8/KR6 w - - 0 1"],
  ])("hard converts king and %s against king into checkmate", (_piece, fen) => {
    const position = Position.fromFen(fen);
    // A slow fake clock keeps each move small; the endgame knowledge in the evaluation has to do the steering.
    const options: SearchOptions = { now: tickingClock(25), random: seededRandom(7) };
    let mated = false;
    for (let ply = 0; ply < 70 && !mated; ply += 1) {
      const result = chooseMove(position, "hard", options);
      if (result.move === null) {
        mated = position.inCheck();
        break;
      }
      position.make(result.move);
      expect(position.repetitionCount()).toBeLessThan(2);
    }
    expect(mated).toBe(true);
  });

  it("avoids a draw by repetition when it is winning", () => {
    const position = Position.fromFen("7k/8/8/8/8/8/5Q2/K7 w - - 0 1");
    // Shuffle so that the position after Qf6+ Kh7 Qf7+ Kh8 has already been seen once.
    for (const uci of ["f2f6", "h8h7", "f6f7", "h7h8", "f7f6", "h8h7", "f6f7", "h7h8"]) {
      const move = position.findMove(uci);
      expect(move).not.toBeNull();
      position.make(move ?? 0);
    }
    const result = chooseMove(position, "expert", fastOptions());
    position.make(result.move ?? 0);
    expect(position.repetitionCount()).toBe(0);
    expect(result.score).toBeGreaterThan(500);
  });
});

describe("chooseMove contract", () => {
  const fens = [START_FEN, MIDDLEGAME, KIWIPETE, ROOK_ENDING, PAWN_ENDING, "8/8/8/3k4/8/8/8/KQ6 b - - 0 1"];
  const cases: [Difficulty, string][] = DIFFICULTIES.flatMap((difficulty) =>
    fens.map((fen): [Difficulty, string] => [difficulty, fen]),
  );

  it.each(cases)("%s returns a legal move and leaves %s untouched", (difficulty, fen) => {
    const position = Position.fromFen(fen);
    const before = { fen: position.toFen(), lo: position.hashLo, hi: position.hashHi, ply: position.ply };
    const result = chooseMove(position, difficulty, fastOptions(3));
    expect(isLegal(position, result.move)).toBe(true);
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.nodes).toBeGreaterThan(0);
    expect({ fen: position.toFen(), lo: position.hashLo, hi: position.hashHi, ply: position.ply }).toEqual(before);
  });

  it("keeps the game history intact so repetitions are still visible to the caller", () => {
    const position = Position.fromFen(START_FEN);
    for (const uci of ["g1f3", "g8f6", "f3g1", "f6g8"]) {
      position.make(position.findMove(uci) ?? 0);
    }
    expect(position.repetitionCount()).toBe(1);
    chooseMove(position, "medium", fastOptions());
    expect(position.repetitionCount()).toBe(1);
    expect(position.ply).toBe(4);
  });

  it("plays the only legal move without thinking", () => {
    const position = Position.fromFen("r6k/8/8/8/8/8/6q1/7K w - - 0 1");
    const legal = position.legalMoves();
    expect(legal.length).toBe(1);
    const result = chooseMove(position, "expert", fastOptions());
    expect(result.move).toBe(legal[0]);
    expect(result.nodes).toBeLessThan(5000);
  });

  it("is deterministic for a given clock and random source", () => {
    const first = chooseMove(Position.fromFen(MIDDLEGAME), "medium", fastOptions(11));
    clearSearchTables();
    const second = chooseMove(Position.fromFen(MIDDLEGAME), "medium", fastOptions(11));
    expect(second).toEqual(first);
  });

  it("works with the default clock and random source", () => {
    const position = Position.fromFen(START_FEN);
    expect(isLegal(position, chooseMove(position, "easy").move)).toBe(true);
  });
});

describe("chooseMove time control", () => {
  const limits: [Difficulty, number][] = [
    ["easy", 400],
    ["medium", 1500],
    ["hard", 1500],
    ["expert", 4000],
  ];

  it.each(limits)("%s answers a middlegame position within %i ms of real time", (difficulty, limit) => {
    const position = Position.fromFen(KIWIPETE);
    const started = performance.now();
    const result = chooseMove(position, difficulty);
    const elapsed = performance.now() - started;
    expect(isLegal(position, result.move)).toBe(true);
    expect(elapsed).toBeLessThan(limit);
  });

  it.each(DIFFICULTIES)("%s stops promptly when the clock jumps past its budget", (difficulty) => {
    const position = Position.fromFen(KIWIPETE);
    const result = chooseMove(position, difficulty, { now: tickingClock(60000), random: seededRandom(5) });
    expect(isLegal(position, result.move)).toBe(true);
    expect(result.nodes).toBeLessThan(60000);
  });

  it("searches deeper when given more time", () => {
    const quick = chooseMove(Position.fromFen(MIDDLEGAME), "expert", { now: tickingClock(100) });
    clearSearchTables();
    const slow = chooseMove(Position.fromFen(MIDDLEGAME), "expert", { now: tickingClock(5) });
    expect(slow.depth).toBeGreaterThan(quick.depth);
    expect(slow.nodes).toBeGreaterThan(quick.nodes);
  });

  it("hard never searches past its depth cap", () => {
    const result = chooseMove(Position.fromFen(PAWN_ENDING), "hard", { now: tickingClock(0.001) });
    expect(result.depth).toBeLessThanOrEqual(LEVEL_SETTINGS.hard.maxDepth);
  });
});
