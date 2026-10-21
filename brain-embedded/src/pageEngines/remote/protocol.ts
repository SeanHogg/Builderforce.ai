/**
 * THE frames for reaching a page engine that runs somewhere else — ONE declaration for
 * every boundary it crosses (PRD 34 §3.4):
 *
 *  - the editor's extension host ↔ its chat webview (postMessage), and ↔ its own `bfi`
 *    worker (`worker_threads`);
 *  - a page (web, Rovr) ↔ the dedicated Web Worker its `bfi` engine runs in, so CPU
 *    decoding never blocks the page.
 *
 *   caller → engine   `pageEngine.probe` · `pageEngine.chat` · `pageEngine.abort`
 *   engine → caller   `pageEngine.probed` · `pageEngine.chunk` · `pageEngine.end` · `pageEngine.error`
 *                     · `pageEngine.alive` (a chat still running with nothing to send yet — a
 *                       load, a queued turn — so the caller's inactivity timeout is not hit)
 *
 * Every frame carries the request `id` the caller minted. Pure — no DOM, no Node.
 */
import type { LocalRuntimeId, LocalRuntimeProbe } from '@builderforce/local-inference';

/** caller → engine */
export type PageEngineRequest =
  | { type: 'pageEngine.probe'; id: string; runtime: LocalRuntimeId; fresh?: boolean }
  | { type: 'pageEngine.chat'; id: string; runtime: LocalRuntimeId; body: Record<string, unknown> }
  | { type: 'pageEngine.abort'; id: string };

/** engine → caller */
export type PageEngineReply =
  | { type: 'pageEngine.probed'; id: string; probe: LocalRuntimeProbe | null }
  | { type: 'pageEngine.chunk'; id: string; chunk: unknown }
  | { type: 'pageEngine.end'; id: string }
  | { type: 'pageEngine.alive'; id: string }
  | { type: 'pageEngine.error'; id: string; status: number; code: string; message: string };

export const PAGE_ENGINE_REQUEST_TYPES = ['pageEngine.probe', 'pageEngine.chat', 'pageEngine.abort'] as const;
export const PAGE_ENGINE_REPLY_TYPES = ['pageEngine.probed', 'pageEngine.chunk', 'pageEngine.end', 'pageEngine.error', 'pageEngine.alive'] as const;

/** How often an engine that is still working on a chat says so (`pageEngine.alive`). */
export const PAGE_ENGINE_HEARTBEAT_MS = 30_000;

const has = (types: readonly string[], message: unknown, idRequired: boolean): boolean => {
  if (!message || typeof message !== 'object') return false;
  const { type, id } = message as { type?: unknown; id?: unknown };
  return typeof type === 'string' && types.includes(type) && (!idRequired || typeof id === 'string');
};

/** Whether a caller-received message is one of the engine's replies. */
export function isPageEngineReply(message: unknown): message is PageEngineReply {
  return has(PAGE_ENGINE_REPLY_TYPES, message, true);
}

/** Whether an engine-received message is one of the caller's requests. */
export function isPageEngineRequest(message: unknown): message is PageEngineRequest {
  return has(PAGE_ENGINE_REQUEST_TYPES, message, true);
}
