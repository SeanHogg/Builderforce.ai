/**
 * Reporting a framed page's own errors back to whatever is previewing it.
 *
 * ── WHY THIS IS IN THE ERROR SDK AND NOT IN THE CANVAS ───────────────────────────
 * The Builderforce Creation Canvas can frame any address, and a framed page is opaque by
 * construction: the embedder cannot read `contentWindow.console`, cannot receive its
 * error events, and cannot see its failed requests. That is the browser's security model,
 * not something effort fixes. So a preview that was throwing on every load looked
 * identical to one that worked.
 *
 * Documents the canvas WRITES carry an injected reporter, because we wrote them. A page
 * somebody else wrote can only cooperate — and the SDK that already hooks `error` and
 * `unhandledrejection` for this exact page is the natural place for it to do so. Turning
 * it on costs a page that is already using this SDK nothing: the same events it is
 * shipping to the Quality ingest are ALSO posted to the parent frame, when there is one.
 *
 * ── THE ONE THING IT MUST NOT DO ─────────────────────────────────────────────────
 * `postMessage` to a parent is visible to that parent. So this NEVER runs unframed
 * (`window === window.parent` returns immediately), and it posts messages, never data:
 * a level, a truncated line of text, and a millisecond offset. There is no page content,
 * no request body and no header in the wire shape, and none may be added to it — the
 * receiving document may belong to anyone who framed you.
 *
 * ── THE WIRE ─────────────────────────────────────────────────────────────────────
 * `{ tag, level, text, at }`, tag first, matching
 * `frontend/src/lib/canvasPreviewReport.ts` — which is the reader, and the module that
 * documents the contract. This package is published standalone and cannot import that
 * file, so the tag is a literal here and `canvasPreview.test.ts` guards it against drift.
 */

/** The tag the canvas matches on. Keep in step with `CANVAS_PREVIEW_MESSAGE`. */
export const CANVAS_PREVIEW_MESSAGE = 'builderforce:canvas-preview';

export type CanvasPreviewLevel = 'log' | 'warn' | 'error' | 'request';

export interface CanvasPreviewMessage {
  tag: typeof CANVAS_PREVIEW_MESSAGE;
  level: CanvasPreviewLevel;
  text: string;
  /** Milliseconds since the reporter was installed, so a console reads as a run. */
  at: number;
}

/** Longest line posted. Matches the reader's own cap, so nothing is silently halved. */
const MAX_TEXT = 500;

export interface CanvasPreviewReporterOptions {
  /** Mirror `console.log`/`warn`/`error`. Default true — a preview with no console is
   *  the gap this exists to close. The originals are always called. */
  console?: boolean;
  /** Report each `fetch` and every call that fails or returns 4xx/5xx. Default true. */
  network?: boolean;
  /** Injected for tests. Defaults to the real `window`. */
  target?: Window & typeof globalThis;
}

/**
 * Install the reporter. Returns a detach function, and a NO-OP detach when the page is
 * not framed — the unframed case must cost an ordinary page nothing at all.
 */
export function installCanvasPreviewReporter(options: CanvasPreviewReporterOptions = {}): () => void {
  const view = options.target ?? (typeof window !== 'undefined' ? window : undefined);
  if (!view || view === view.parent) return () => {};

  const t0 = Date.now();
  const detach: Array<() => void> = [];

  const say = (level: CanvasPreviewLevel, text: string): void => {
    try {
      const message: CanvasPreviewMessage = {
        tag: CANVAS_PREVIEW_MESSAGE, level, text: String(text).slice(0, MAX_TEXT), at: Date.now() - t0,
      };
      view.parent.postMessage(message, '*');
    } catch { /* a parent that refuses the message is not this page's problem */ }
  };

  if (options.console !== false) {
    // Narrowed to the three the console actually has — `request` is a preview level, not
    // a console method, and indexing `Console` by the wider union is what said so.
    const levels: Array<Extract<CanvasPreviewLevel, 'log' | 'warn' | 'error'>> = ['log', 'warn', 'error'];
    for (const level of levels) {
      const original = view.console[level] as (...args: unknown[]) => void;
      const patched = (...args: unknown[]): void => {
        try { say(level, args.map(printable).join(' ')); } catch { /* never break the page */ }
        original.apply(view.console, args);
      };
      (view.console as unknown as Record<string, unknown>)[level] = patched;
      detach.push(() => { (view.console as unknown as Record<string, unknown>)[level] = original; });
    }
  }

  /**
   * Capture phase, deliberately. A subresource that 404s fires `error` on the ELEMENT and
   * does not bubble to `window`, so a plain listener misses the single most common way a
   * preview is broken — a script or stylesheet that never loaded.
   */
  const onError = (event: Event): void => {
    const target = event.target as { src?: string; href?: string } | null;
    if (target && target !== (view as unknown) && (target.src || target.href)) {
      say('error', `failed to load ${target.src || target.href}`);
      return;
    }
    say('error', (event as ErrorEvent).message || 'script error');
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason as { message?: string } | undefined;
    say('error', `Unhandled rejection: ${reason?.message ?? String(reason)}`);
  };
  view.addEventListener('error', onError, true);
  view.addEventListener('unhandledrejection', onRejection);
  detach.push(
    () => view.removeEventListener('error', onError, true),
    () => view.removeEventListener('unhandledrejection', onRejection),
  );

  if (options.network !== false && typeof view.fetch === 'function') {
    const nativeFetch = view.fetch;
    const patched: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      const method = (init?.method ?? (input as Request).method ?? 'GET').toUpperCase();
      say('request', `${method} ${url}`);
      return nativeFetch.call(view, input, init).then(
        (response) => {
          if (response.status >= 400) say('error', `${method} ${url} — ${response.status}`);
          return response;
        },
        (error: unknown) => {
          say('error', `${method} ${url} — request failed`);
          throw error;
        },
      );
    };
    view.fetch = patched;
    detach.push(() => { view.fetch = nativeFetch; });
  }

  return () => { for (const stop of detach) stop(); detach.length = 0; };
}

/** A console argument as one line, without letting a circular object throw. */
function printable(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
