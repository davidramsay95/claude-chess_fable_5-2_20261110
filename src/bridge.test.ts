import { describe, expect, it } from "vitest";
import { type BridgeEvent, type BridgeHost, type BridgeWindow, installBridge } from "./bridge";
import { START_FEN } from "./chess/position";
import { Game, type GameState } from "./game/game";

const ORIGIN = "https://claude-chess.example";

const FOOLS_MATE: GameState = {
  version: 1,
  startFen: START_FEN,
  playerColor: "white",
  difficulty: "medium",
  moves: ["f2f3", "e7e5", "g2g4", "d8h4"],
  resigned: false,
};

interface Sent {
  message: unknown;
  targetOrigin: string;
}

interface Harness {
  sent: Sent[];
  host: BridgeHost & { game: Game | null };
  deliver: (data: unknown, overrides?: Partial<BridgeEvent>) => void;
  uninstall: () => void;
}

const createHarness = (initial: Game | null = null): Harness => {
  const sent: Sent[] = [];
  const listeners = new Set<(event: BridgeEvent) => void>();
  const parent = {
    postMessage: (message: unknown, targetOrigin: string): void => {
      sent.push({ message, targetOrigin });
    },
  };
  const fakeWindow: BridgeWindow = {
    parent,
    location: { origin: ORIGIN },
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  const host: Harness["host"] = {
    game: initial,
    currentGame: (): Game | null => host.game,
    importState: (state: unknown): void => {
      host.game = Game.fromState(state);
    },
  };
  const uninstall = installBridge(fakeWindow, host);
  const deliver: Harness["deliver"] = (data, overrides = {}) => {
    const event: BridgeEvent = { origin: ORIGIN, source: parent, data, ...overrides };
    listeners.forEach((listener) => listener(event));
  };
  return { sent, host, deliver, uninstall };
};

const shell = (fields: Record<string, unknown>): Record<string, unknown> => ({ source: "claude-chess-shell", ...fields });

describe("save bridge", () => {
  it("announces ready on install, to its own origin only", () => {
    const { sent } = createHarness();
    expect(sent).toEqual([{ message: { source: "claude-chess-game", type: "ready" }, targetOrigin: ORIGIN }]);
  });

  it("answers ping with ready", () => {
    const { sent, deliver } = createHarness();
    deliver(shell({ type: "ping" }));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ message: { source: "claude-chess-game", type: "ready" }, targetOrigin: ORIGIN });
  });

  it("answers request-state with nulls before a game has started", () => {
    const { sent, deliver } = createHarness();
    deliver(shell({ type: "request-state", requestId: "r-1" }));
    expect(sent[1].message).toEqual({
      source: "claude-chess-game",
      type: "state",
      requestId: "r-1",
      state: null,
      summary: null,
    });
  });

  it("answers request-state with the export and a summary", () => {
    const { sent, deliver } = createHarness(Game.fromState(FOOLS_MATE));
    deliver(shell({ type: "request-state", requestId: "r-2" }));
    expect(sent[1]).toEqual({
      message: {
        source: "claude-chess-game",
        type: "state",
        requestId: "r-2",
        state: FOOLS_MATE,
        summary: { result: "0-1", moveCount: 4 },
      },
      targetOrigin: ORIGIN,
    });
  });

  it("loads a valid state and reports success", () => {
    const { sent, host, deliver } = createHarness();
    deliver(shell({ type: "load-state", requestId: "r-3", state: FOOLS_MATE }));
    expect(sent[1].message).toEqual({ source: "claude-chess-game", type: "loaded", requestId: "r-3", ok: true });
    expect(host.game?.toState()).toEqual(FOOLS_MATE);
  });

  it("rejects an invalid state with a short error and leaves the game untouched", () => {
    const original = Game.create("black", "hard");
    original.playUci("e2e4");
    const { sent, host, deliver } = createHarness(original);
    const before = original.toState();
    deliver(shell({ type: "load-state", requestId: "r-4", state: { ...FOOLS_MATE, moves: ["f2f3", "e7e5", "g2g5"] } }));
    expect(sent[1].message).toEqual({
      source: "claude-chess-game",
      type: "loaded",
      requestId: "r-4",
      ok: false,
      error: "Move 3 (g2g5) is not legal",
    });
    expect(host.game).toBe(original);
    expect(original.toState()).toEqual(before);
  });

  it("rejects a load-state with no state at all", () => {
    const { sent, deliver } = createHarness();
    deliver(shell({ type: "load-state", requestId: "r-5" }));
    expect(sent[1].message).toMatchObject({ type: "loaded", requestId: "r-5", ok: false });
  });

  it("ignores messages from another origin", () => {
    const { sent, host, deliver } = createHarness();
    deliver(shell({ type: "ping" }), { origin: "https://evil.example" });
    deliver(shell({ type: "load-state", requestId: "x", state: FOOLS_MATE }), { origin: "https://evil.example" });
    expect(sent).toHaveLength(1);
    expect(host.game).toBeNull();
  });

  it("ignores messages from a window that is not the parent", () => {
    const { sent, host, deliver } = createHarness();
    deliver(shell({ type: "ping" }), { source: { postMessage: (): void => {} } });
    deliver(shell({ type: "load-state", requestId: "x", state: FOOLS_MATE }), { source: null });
    expect(sent).toHaveLength(1);
    expect(host.game).toBeNull();
  });

  it.each([
    [null],
    ["ping"],
    [{ type: "ping" }],
    [{ source: "claude-chess-game", type: "ping" }],
    [{ source: "claude-chess-shell" }],
    [{ source: "claude-chess-shell", type: "unknown" }],
    [{ source: "claude-chess-shell", type: "request-state" }],
    [{ source: "claude-chess-shell", type: "load-state", requestId: 7, state: FOOLS_MATE }],
  ])("ignores malformed message %#", (data) => {
    const { sent, host, deliver } = createHarness();
    deliver(data);
    expect(sent).toHaveLength(1);
    expect(host.game).toBeNull();
  });

  it("stops answering after uninstall", () => {
    const { sent, deliver, uninstall } = createHarness();
    uninstall();
    deliver(shell({ type: "ping" }));
    expect(sent).toHaveLength(1);
  });
});
