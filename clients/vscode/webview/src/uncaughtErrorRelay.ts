/**
 * Errors no React boundary can catch — a throw in an event handler, a timer, a lazy
 * chunk's top level, or a promise nobody awaited — relayed to the host's output channel.
 *
 * LOG ONLY. The tree survived these (otherwise `RootBoundary` would have caught them),
 * so flipping the panel to the error fallback would turn a working panel into a broken
 * one. What they need is a record somewhere a person can read it: a webview's console is
 * not that place.
 */

/** The `webview.error` payload, as the host's `webviewErrorLines` reads it. */
export interface WebviewErrorReport {
  source: 'render' | 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
  componentStack?: string;
}

/** Long stacks are capped so one runaway report cannot flood the bridge. */
const STACK_LIMIT = 4_000;

/** The report for any thrown value — an `Error`, a string, or something stranger. */
export function errorReport(source: WebviewErrorReport['source'], thrown: unknown, componentStack?: string | null): WebviewErrorReport {
  const error = thrown instanceof Error ? thrown : undefined;
  let message = error?.message ?? '';
  if (!error && thrown != null) {
    try {
      message = typeof thrown === 'string' ? thrown : JSON.stringify(thrown) ?? String(thrown);
    } catch {
      message = String(thrown);
    }
  }
  return {
    source,
    message: message || 'unknown error',
    ...(error?.stack ? { stack: error.stack.slice(0, STACK_LIMIT) } : {}),
    ...(componentStack ? { componentStack: componentStack.slice(0, STACK_LIMIT) } : {}),
  };
}

type ErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** The same error (source + message) is relayed at most once in this window. */
export const REPEAT_WINDOW_MS = 5_000;
/** At most this many reports a minute, whatever they say. */
export const REPORTS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

/**
 * Wraps `report` so a throw that repeats every frame cannot flood the bridge and the log: each
 * source + message passes once per {@link REPEAT_WINDOW_MS}, at most {@link REPORTS_PER_MINUTE}
 * pass a minute, and what was held back is said in one "suppressed N" line when the window closes.
 * Returns the throttled reporter and its disposer (clears the pending summary timer).
 */
export function throttledReporter(report: (r: WebviewErrorReport) => void): { report: (r: WebviewErrorReport) => void; dispose: () => void } {
  const lastSent = new Map<string, number>();
  const suppressed = new Map<string, { source: WebviewErrorReport['source']; message: string; count: number }>();
  let sentAt: number[] = [];
  let flush: ReturnType<typeof setTimeout> | undefined;
  const summarize = () => {
    flush = undefined;
    if (suppressed.size === 0) return;
    const held = [...suppressed.values()];
    suppressed.clear();
    const total = held.reduce((n, h) => n + h.count, 0);
    const first = held[0]!;
    const message = `suppressed ${total} repeated webview error report${total === 1 ? '' : 's'}: ${held.map((h) => `${h.count}× ${h.message}`).join('; ')}`.slice(0, STACK_LIMIT);
    report({ source: first.source, message });
  };
  return {
    report: (r) => {
      const now = Date.now();
      const key = `${r.source}\u0000${r.message}`;
      sentAt = sentAt.filter((t) => now - t < MINUTE_MS);
      const last = lastSent.get(key);
      if ((last !== undefined && now - last < REPEAT_WINDOW_MS) || sentAt.length >= REPORTS_PER_MINUTE) {
        const held = suppressed.get(key);
        if (held) held.count += 1;
        else suppressed.set(key, { source: r.source, message: r.message, count: 1 });
        flush ??= setTimeout(summarize, REPEAT_WINDOW_MS);
        return;
      }
      if (lastSent.size >= 200) for (const [k, t] of lastSent) if (now - t >= REPEAT_WINDOW_MS) lastSent.delete(k);
      lastSent.set(key, now);
      sentAt.push(now);
      report(r);
    },
    dispose: () => { clearTimeout(flush); flush = undefined; },
  };
}

/** Install the two window listeners, relaying through {@link throttledReporter}. Returns the uninstaller (for tests). */
export function installUncaughtErrorRelay(report: (r: WebviewErrorReport) => void, target: ErrorTarget = window): () => void {
  const relay = throttledReporter(report);
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    // A failed <img>/<script> load fires `error` with no `error` value and no message.
    if (!e.error && !e.message) return;
    relay.report(errorReport('error', e.error ?? e.message));
  };
  const onRejection = (event: Event) => relay.report(errorReport('unhandledrejection', (event as PromiseRejectionEvent).reason));
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    relay.dispose();
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
