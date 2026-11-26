/**
 * ONE way to run a callback when the browser is idle: `requestIdleCallback` (with a timeout, so a busy page
 * cannot starve it forever), else `setTimeout(0)`. Returns the function that cancels it.
 */

/** The longest an idle callback may be postponed by a busy main thread. */
export const IDLE_TIMEOUT_MS = 500;

interface IdleGlobals {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
}

export function scheduleIdle(cb: () => void): () => void {
    const g = globalThis as IdleGlobals;
    if (g.requestIdleCallback) {
        const handle = g.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
        return () => g.cancelIdleCallback?.(handle);
    }
    const handle = setTimeout(cb, 0);
    return () => clearTimeout(handle);
}
