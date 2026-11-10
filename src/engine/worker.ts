import type { EngineRequest } from "./protocol";
import { respond } from "./respond";

self.addEventListener("message", (event: MessageEvent<EngineRequest>): void => {
  self.postMessage(respond(event.data));
});
