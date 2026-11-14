/**
 * The editor's two webview ↔ host frame families for on-device models (PRD 34 §3.4).
 *
 * 1. The page-engine frames — brain-embedded's ONE declaration (`remote/protocol.ts`),
 *    re-exported here so both halves of the editor name them from one place. The
 *    editor's runs live in the extension host (Node, no WebGPU); the chat webview runs
 *    the page engines, and the host reaches them by asking:
 *
 *      host → webview   `pageEngine.probe` · `pageEngine.chat` · `pageEngine.abort`
 *      webview → host   `pageEngine.probed` · `pageEngine.chunk` · `pageEngine.end` · `pageEngine.error`
 *                       · `pageEngine.alive` (still working — the host's inactivity timeout)
 *
 *    The same frames serve the host's own `bfi` worker (`hostBfi/`), over
 *    `worker_threads`.
 *
 * 2. The model-file frames: in the editor the extension host's file cache is the ONE
 *    copy of an `hf-file` model (the Bonsai GGUFs). The webview's model store is a view
 *    of it — status, download, remove, and the bytes `BfiEngine.load` streams, pulled a
 *    chunk per request — so a model is downloaded once and both the webview's engine and
 *    the host worker load it.
 *
 *      webview → host (request/response)  `modelFile.status` · `modelFile.open` · `modelFile.read`
 *                                         · `modelFile.remove` · `modelFile.download`
 *                                         · `modelFile.support` (the host's CPU record,
 *                                           read without its wasm — the picker's other half)
 *      webview → host (post)              `modelFile.close` · `modelFile.cancel`
 *      host → webview (post)              `modelFile.progress` · `modelFile.downloaded`
 *
 * Every webview→host name is also listed in `bridgeProtocol.ts` so the webview's typed
 * `post` / `request` accept them. Pure — no `vscode`, no DOM — so both halves and their
 * tests import it.
 */
export { PAGE_ENGINE_REPLY_TYPES, PAGE_ENGINE_REQUEST_TYPES, isPageEngineReply, } from "@seanhogg/builderforce-brain-embedded";
/** webview → host requests (answered by the panel's `response`). */
export const MODEL_FILE_REQUEST_TYPES = [
    "modelFile.status",
    "modelFile.open",
    "modelFile.read",
    "modelFile.remove",
    "modelFile.download",
    "modelFile.support",
];
/** webview → host fire-and-forget. */
export const MODEL_FILE_POST_TYPES = ["modelFile.close", "modelFile.cancel"];
export const MODEL_FILE_EVENT_TYPES = ["modelFile.progress", "modelFile.downloaded"];
/** Whether a host-received message is a model-file frame. */
export function isModelFileRequest(message) {
    if (!message || typeof message !== "object")
        return false;
    const { type } = message;
    return (typeof type === "string" &&
        (MODEL_FILE_REQUEST_TYPES.includes(type) || MODEL_FILE_POST_TYPES.includes(type)));
}
//# sourceMappingURL=pageEngineBridgeProtocol.js.map