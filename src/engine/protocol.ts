import type { Difficulty } from "../game/types";

/** Sent from the page to the engine worker. The worker replays the whole game so it sees repetitions. */
export interface EngineRequest {
  id: number;
  startFen: string;
  moves: string[];
  difficulty: Difficulty;
}

/** Sent back by the worker. `move` is UCI, or null when there is no legal move or `error` is set. */
export interface EngineResponse {
  id: number;
  move: string | null;
  error?: string;
}
