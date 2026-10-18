/**
 * The bridge's TRANSPORT: the one `acquireVsCodeApi` handle, fire-and-forget `post`,
 * the `request`/`response` round-trip, and the ONE `message` listener every host frame
 * arrives through.
 *
 * Modules that interpret a host frame (`bridgeState.ts`, `hostFetch.ts`) claim its
 * type with {@link handleFrame}; anything unclaimed is delivered to
 * {@link onHostMessage} subscribers (the run relay: `run.sync`, `run.settled`, …).
 * Import from `./vscodeBridge`, never from here — that is the public entry.
 */

import type { HostMessageType } from '../../src/bridgeProtocol';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

/** A host frame as it arrives: a `type` plus whatever fields that type carries. */
export type HostFrame = { type?: string; id?: string } & Record<string, unknown>;

/** Add `cb` to a subscriber list; returns the unsubscribe. */
export function subscribe<T>(list: T[], cb: T): () => void {
  list.push(cb);
  return () => {
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  };
}

let seq = 0;
/** The bridge's ONE id counter — requests (`r…`) and host streams (`s…`) share it. */
export const nextId = (prefix: string): string => `${prefix}${++seq}`;

/**
 * Fire-and-forget message to the host.
 *
 * `type` is the shared union, not `string`: a name no host handles is a permanent
 * silent no-op, and that is exactly what an untyped bridge cannot tell you about.
 * See `src/bridgeProtocol.ts`.
 */
export function post(type: HostMessageType, payload?: Record<string, unknown>): void {
  api.postMessage({ type, ...(payload ?? {}) });
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

/** A never-answered request (the host dropped its response, or the panel was torn
 *  down mid-flight) would otherwise leak its promise + Map entry for the life of the
 *  webview. Reject + evict after this long so nothing accumulates. Generous, so a
 *  legitimately slow round-trip (a file picker the user leaves open, a slow tool)
 *  still resolves normally. */
const REQUEST_TIMEOUT_MS = 300_000;

/** Reject + evict a pending entry (timeout / teardown), clearing its timer. */
function settlePending(id: string, error: Error): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.reject(error);
}

/** Request/response round-trip to the host (resolved by a matching `response`).
 *  Same typed vocabulary as {@link post} — a request nobody answers hangs until the
 *  timeout below, which is a slower and more confusing version of the same bug. */
export function request<T = unknown>(type: HostMessageType, payload?: Record<string, unknown>): Promise<T> {
  const id = nextId('r');
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => settlePending(id, new Error(`Request "${type}" timed out`)), REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    api.postMessage({ type, id, ...(payload ?? {}) });
  });
}

/** Teardown hooks run on `pagehide`, after every in-flight request is rejected. */
const teardowns: Array<() => void> = [];
export function onTeardown(cb: () => void): void {
  teardowns.push(cb);
}

// Reject every in-flight request when the webview is torn down (the panel was
// disposed / navigated away), so no promise is left dangling.
window.addEventListener('pagehide', () => {
  for (const id of [...pending.keys()]) settlePending(id, new Error('webview closed'));
  for (const t of teardowns) t();
});

/**
 * A frame type the bridge itself interprets. The handler returns `false` to decline a
 * frame (e.g. an `intent` with no intent), which then falls through to
 * {@link onHostMessage} subscribers exactly as an unclaimed type would.
 */
type FrameHandler = (m: HostFrame) => boolean | void;
const frameHandlers = new Map<string, FrameHandler>();
export function handleFrame(types: string | string[], handler: FrameHandler): void {
  for (const t of Array.isArray(types) ? types : [types]) frameHandlers.set(t, handler);
}

handleFrame('response', (m) => {
  if (!m.id) return false;
  const p = pending.get(m.id);
  if (p) {
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error((m.error as string | undefined) || 'host error'));
  }
});

/**
 * Subscribe to a host-posted message TYPE the bridge does not itself interpret (the
 * run relay: `run.sync`, `run.settled`, …). Returns an unsubscribe. The frame is
 * delivered whole; the bridge's own frames (`init`, `intent`, `response`, …) never
 * reach these subscribers.
 */
const hostMessageWaiters = new Map<string, Set<(frame: never) => void>>();
export function onHostMessage<T extends object>(type: string, cb: (frame: T) => void): () => void {
  let set = hostMessageWaiters.get(type);
  if (!set) {
    set = new Set();
    hostMessageWaiters.set(type, set);
  }
  set.add(cb as (frame: never) => void);
  return () => {
    set?.delete(cb as (frame: never) => void);
  };
}

window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as HostFrame;
  if (!m || typeof m !== 'object') return;
  const handler = m.type ? frameHandlers.get(m.type) : undefined;
  if (handler && handler(m) !== false) return;
  const waiters = m.type ? hostMessageWaiters.get(m.type) : undefined;
  if (waiters) for (const w of [...waiters]) (w as (frame: unknown) => void)(m);
});
