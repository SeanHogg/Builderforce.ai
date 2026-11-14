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
const api = acquireVsCodeApi();
/** Add `cb` to a subscriber list; returns the unsubscribe. */
export function subscribe(list, cb) {
    list.push(cb);
    return () => {
        const i = list.indexOf(cb);
        if (i >= 0)
            list.splice(i, 1);
    };
}
let seq = 0;
/** The bridge's ONE id counter — requests (`r…`) and host streams (`s…`) share it. */
export const nextId = (prefix) => `${prefix}${++seq}`;
/**
 * Fire-and-forget message to the host.
 *
 * `type` is the shared union, not `string`: a name no host handles is a permanent
 * silent no-op, and that is exactly what an untyped bridge cannot tell you about.
 * See `src/bridgeProtocol.ts`.
 */
export function post(type, payload) {
    api.postMessage(envelope(payload, { type }));
}
/**
 * The frame as posted: the payload with the ENVELOPE (`type`, and `id` for a request)
 * laid over it, so a payload field of the same name can never re-address the frame. An
 * attachment's MIME type once rode as `type` and turned `attachment.ingress` into
 * `application/pdf`, which no host case matched — the request hung until its timeout.
 */
export function envelope(payload, head) {
    return { ...(payload ?? {}), ...head };
}
const pending = new Map();
/** A never-answered request (the host dropped its response, or the panel was torn
 *  down mid-flight) would otherwise leak its promise + Map entry for the life of the
 *  webview. Reject + evict after this long so nothing accumulates. Generous, so a
 *  legitimately slow round-trip (a file picker the user leaves open, a slow tool)
 *  still resolves normally. */
const REQUEST_TIMEOUT_MS = 300_000;
/** Reject + evict a pending entry (timeout / teardown), clearing its timer. */
function settlePending(id, error) {
    const p = pending.get(id);
    if (!p)
        return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.reject(error);
}
/** Request/response round-trip to the host (resolved by a matching `response`).
 *  Same typed vocabulary as {@link post} — a request nobody answers hangs until the
 *  timeout below, which is a slower and more confusing version of the same bug. */
export function request(type, payload) {
    const id = nextId('r');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settlePending(id, new Error(`Request "${type}" timed out`)), REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve: resolve, reject, timer });
        api.postMessage(envelope(payload, { type, id }));
    });
}
/** Teardown hooks run on `pagehide`, after every in-flight request is rejected. */
const teardowns = [];
export function onTeardown(cb) {
    teardowns.push(cb);
}
// Reject every in-flight request when the webview is torn down (the panel was
// disposed / navigated away), so no promise is left dangling.
window.addEventListener('pagehide', () => {
    for (const id of [...pending.keys()])
        settlePending(id, new Error('webview closed'));
    for (const t of teardowns)
        t();
});
const frameHandlers = new Map();
export function handleFrame(types, handler) {
    for (const t of Array.isArray(types) ? types : [types])
        frameHandlers.set(t, handler);
}
handleFrame('response', (m) => {
    if (!m.id)
        return false;
    const p = pending.get(m.id);
    if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok)
            p.resolve(m.result);
        else
            p.reject(new Error(m.error || 'host error'));
    }
});
/**
 * Subscribe to a host-posted message TYPE the bridge does not itself interpret (the
 * run relay: `run.sync`, `run.settled`, …). Returns an unsubscribe. The frame is
 * delivered whole; the bridge's own frames (`init`, `intent`, `response`, …) never
 * reach these subscribers.
 */
const hostMessageWaiters = new Map();
export function onHostMessage(type, cb) {
    let set = hostMessageWaiters.get(type);
    if (!set) {
        set = new Set();
        hostMessageWaiters.set(type, set);
    }
    set.add(cb);
    return () => {
        set?.delete(cb);
    };
}
window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object')
        return;
    const handler = m.type ? frameHandlers.get(m.type) : undefined;
    if (handler && handler(m) !== false)
        return;
    const waiters = m.type ? hostMessageWaiters.get(m.type) : undefined;
    if (waiters)
        for (const w of [...waiters])
            w(m);
});
//# sourceMappingURL=bridgeTransport.js.map