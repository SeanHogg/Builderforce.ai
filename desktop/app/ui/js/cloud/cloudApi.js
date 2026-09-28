// The shared React surfaces call the platform by its REST paths, the way they do inside
// the VS Code extension. Here every call goes out through Synapse's signed-in session
// (`cloud_request`), so the key and its token never reach the page.
import { invoke } from "../bridge.js";

/** `request(path, { method, body })` — the shape `createEvermindRestAdapter` expects. */
export const cloudRequest = (path, init = {}) =>
  invoke("cloud_request", { method: init.method ?? "GET", path, body: init.body ? JSON.parse(init.body) : null });

let bundle = null;
/** The console bundle (React + the shared console), loaded the first time it is needed. */
export const consoleBundle = () => (bundle ??= import("../../vendor/evermind.js"));
