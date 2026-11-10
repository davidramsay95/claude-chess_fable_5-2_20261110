import { installBridge } from "./bridge";
import "./ui/style.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("The page is missing its #app element");
}
const app = new App(root);
// Installed after the app exists, so the "ready" message is only sent once requests can be answered.
installBridge(window, app);
