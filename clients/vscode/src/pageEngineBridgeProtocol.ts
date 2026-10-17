/**
 * The page-engine bridge's frames — ONE declaration for both halves (PRD 34 §3.4).
 *
 * The editor's runs live in the extension host, a Node process with no WebGPU; the chat
 * webview is Chromium and has it. So the page engines (WebGPU `bfi`, WebLLM, the
 * browser's built-in model) run in the webview, and the host reaches them by asking:
 *
 *   host → webview   `pageEngine.probe` · `pageEngine.chat` · `pageEngine.abort`
 *   webview → host   `pageEngine.probed` · `pageEngine.chunk` · `pageEngine.end` · `pageEngine.error`
 *
 * Every frame carries the request `id` the host minted. The webview→host names are also
 * listed in `bridgeProtocol.ts` (`PAGE_ENGINE_HOST_MESSAGES`) so the webview's typed
 * `post` accepts them.
 *
 * Pure — no `vscode`, no DOM — so both halves and their tests import it.
 */
import type { LocalRuntimeId, LocalRuntimeProbe } from "@builderforce/local-inference";

/** host → webview */
export type PageEngineRequest =
  | { type: "pageEngine.probe"; id: string; runtime: LocalRuntimeId; fresh?: boolean }
  | { type: "pageEngine.chat"; id: string; runtime: LocalRuntimeId; body: Record<string, unknown> }
  | { type: "pageEngine.abort"; id: string };

/** webview → host */
export type PageEngineReply =
  | { type: "pageEngine.probed"; id: string; probe: LocalRuntimeProbe | null }
  | { type: "pageEngine.chunk"; id: string; chunk: unknown }
  | { type: "pageEngine.end"; id: string }
  | { type: "pageEngine.error"; id: string; status: number; code: string; message: string };

export const PAGE_ENGINE_REQUEST_TYPES = ["pageEngine.probe", "pageEngine.chat", "pageEngine.abort"] as const;

/** Whether a host-received message is one of the bridge's replies. */
export function isPageEngineReply(message: unknown): message is PageEngineReply {
  if (!message || typeof message !== "object") return false;
  const { type, id } = message as { type?: unknown; id?: unknown };
  return typeof id === "string" && typeof type === "string"
    && (type === "pageEngine.probed" || type === "pageEngine.chunk" || type === "pageEngine.end" || type === "pageEngine.error");
}
