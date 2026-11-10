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

/** Install the two window listeners. Returns the uninstaller (for tests). */
export function installUncaughtErrorRelay(report: (r: WebviewErrorReport) => void, target: ErrorTarget = window): () => void {
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    // A failed <img>/<script> load fires `error` with no `error` value and no message.
    if (!e.error && !e.message) return;
    report(errorReport('error', e.error ?? e.message));
  };
  const onRejection = (event: Event) => report(errorReport('unhandledrejection', (event as PromiseRejectionEvent).reason));
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
