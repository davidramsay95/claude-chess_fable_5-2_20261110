import type { Difficulty } from "../game/types";
import type { EngineRequest, EngineResponse } from "./protocol";

interface Pending {
  id: number;
  resolve: (move: string | null) => void;
  reject: (error: Error) => void;
}

/** Runs the engine in a Web Worker so a long search never blocks the interface. One request at a time. */
export class EngineClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextId = 1;

  /**
   * Asks the engine for its move in the position reached by `moves` from `startFen`.
   * Resolves with a UCI move, or null when the request was cancelled or there is no legal move.
   */
  requestMove(startFen: string, moves: string[], difficulty: Difficulty): Promise<string | null> {
    this.cancel();
    const worker = this.ensureWorker();
    const request: EngineRequest = { id: this.nextId++, startFen, moves, difficulty };
    return new Promise((resolve, reject) => {
      this.pending = { id: request.id, resolve, reject };
      worker.postMessage(request);
    });
  }

  /** Abandons the search in progress. The worker is terminated because a synchronous search cannot be interrupted. */
  cancel(): void {
    if (this.pending === null) {
      return;
    }
    const { resolve } = this.pending;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    resolve(null);
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) {
      return this.worker;
    }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<EngineResponse>): void => {
      const pending = this.pending;
      if (pending === null || pending.id !== event.data.id) {
        return;
      }
      this.pending = null;
      if (event.data.error !== undefined) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data.move);
      }
    });
    worker.addEventListener("error", (event: ErrorEvent): void => {
      const pending = this.pending;
      this.pending = null;
      this.worker = null;
      worker.terminate();
      pending?.reject(new Error(event.message || "The engine worker failed"));
    });
    this.worker = worker;
    return worker;
  }
}
