import { Position, moveToUci } from "../chess/position";
import type { EngineRequest, EngineResponse } from "./protocol";
import { type SearchOptions, chooseMove } from "./search";

/** Answers one request: rebuilds the position from the game's moves and searches it. Never throws. */
export const respond = (request: EngineRequest, options?: SearchOptions): EngineResponse => {
  try {
    const position = Position.fromFen(request.startFen);
    request.moves.forEach((uci, index) => {
      const move = position.findMove(uci);
      if (move === null) {
        throw new Error(`Move ${index + 1} (${uci}) is not legal`);
      }
      position.make(move);
    });
    const { move } = chooseMove(position, request.difficulty, options);
    return { id: request.id, move: move === null ? null : moveToUci(move) };
  } catch (error) {
    return { id: request.id, move: null, error: error instanceof Error ? error.message : "Engine failure" };
  }
};
