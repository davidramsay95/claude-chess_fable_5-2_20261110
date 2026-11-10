import type { Game } from "./game/game";

/**
 * The save bridge: the host site keeps saved games, and asks the game in its iframe for its state (or hands one
 * back) over postMessage. Contract: `docs/save-bridge-protocol.md` in the host repository.
 */

const GAME_SOURCE = "claude-chess-game";
const SHELL_SOURCE = "claude-chess-shell";

export interface BridgeEvent {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

/** The part of `window` the bridge needs, so tests can pass a fake. */
export interface BridgeWindow {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
  readonly location: { readonly origin: string };
  addEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
  removeEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
}

export interface BridgeHost {
  /** The game in progress or finished on screen, or null on the setup screen. */
  currentGame(): Game | null;
  /** The same import the interface uses. Must throw, changing nothing, when the state is invalid. */
  importState(state: unknown): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Starts answering the host site's messages and announces that the game is ready.
 * @returns a function that removes the listener.
 */
export const installBridge = (target: BridgeWindow, host: BridgeHost): (() => void) => {
  const origin = target.location.origin;
  const send = (message: Record<string, unknown>): void => {
    target.parent.postMessage({ source: GAME_SOURCE, ...message }, origin);
  };

  const onMessage = (event: BridgeEvent): void => {
    if (event.origin !== origin || event.source !== target.parent) {
      return;
    }
    const data = event.data;
    if (!isRecord(data) || data.source !== SHELL_SOURCE) {
      return;
    }
    if (data.type === "ping") {
      send({ type: "ready" });
      return;
    }
    const requestId = data.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    if (data.type === "request-state") {
      const game = host.currentGame();
      send({ type: "state", requestId, state: game?.toState() ?? null, summary: game?.summary() ?? null });
      return;
    }
    if (data.type === "load-state") {
      try {
        host.importState(data.state);
        send({ type: "loaded", requestId, ok: true });
      } catch (error) {
        send({
          type: "loaded",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : "The game state could not be loaded",
        });
      }
    }
  };

  target.addEventListener("message", onMessage);
  send({ type: "ready" });
  return (): void => target.removeEventListener("message", onMessage);
};
