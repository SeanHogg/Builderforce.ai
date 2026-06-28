/**
 * @seanhogg/builderforce-quality — embeddable browser error-capture SDK.
 *
 * Drop-in: `BuilderforceQuality.init({ key, endpoint })` hooks `window.onerror` +
 * `unhandledrejection`, batches captured errors, and ships them to your keyed
 * Quality ingest endpoint in the canonical format. Manual capture via
 * `captureException` / `captureMessage`. Flushes on a timer and on page hide
 * (via `sendBeacon`) so nothing is lost on navigation.
 */

import type { CaptureContext, NormalizedErrorEvent, QualityClientOptions } from './types';
import { toEvent, postEvents } from './core';

export type { CaptureContext, NormalizedErrorEvent, QualityClientOptions, ErrorLevel, StackFrame } from './types';

const DEFAULTS = { maxBatch: 20, flushIntervalMs: 5000, autoCapture: true };

export class QualityClient {
  private readonly opts: Required<Pick<QualityClientOptions, 'maxBatch' | 'flushIntervalMs' | 'autoCapture'>> & QualityClientOptions;
  private buffer: NormalizedErrorEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private detach: Array<() => void> = [];

  constructor(options: QualityClientOptions) {
    if (!options.key) throw new Error('builderforce-quality: `key` is required');
    if (!options.endpoint) throw new Error('builderforce-quality: `endpoint` is required');
    this.opts = { ...DEFAULTS, ...options };
    if (this.opts.autoCapture) this.installBrowserHooks();
    if (typeof setInterval !== 'undefined') {
      this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
      // Don't keep a Node process alive purely for the flush timer.
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }
  }

  /** Current page URL, when running in a browser. */
  private currentUrl(): string | null {
    return typeof location !== 'undefined' ? location.href : null;
  }

  /** Capture an Error (or any thrown value). */
  captureException(err: unknown, ctx?: CaptureContext): void {
    this.enqueue(toEvent(err, this.opts, ctx, this.currentUrl()));
  }

  /** Capture a plain message (no Error object). */
  captureMessage(message: string, ctx?: CaptureContext): void {
    this.enqueue(toEvent(new Error(message), this.opts, { level: 'info', ...ctx }, this.currentUrl()));
  }

  private enqueue(ev: NormalizedErrorEvent): void {
    this.buffer.push(ev);
    if (this.buffer.length >= this.opts.maxBatch) void this.flush();
  }

  /** Send any buffered events now. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const ok = await postEvents(this.opts, batch);
    // Re-queue on failure so a transient outage doesn't drop reports (bounded).
    if (!ok) this.buffer.unshift(...batch.slice(0, this.opts.maxBatch * 5));
  }

  /** Best-effort synchronous flush for page-hide via sendBeacon. */
  private beacon(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const url = `${this.opts.endpoint.replace(/\/$/, '')}/events?key=${encodeURIComponent(this.opts.key)}`;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.sendBeacon) {
      nav.sendBeacon(url, new Blob([JSON.stringify(batch)], { type: 'application/json' }));
    } else {
      void postEvents(this.opts, batch);
    }
  }

  private installBrowserHooks(): void {
    const w = typeof window !== 'undefined' ? window : undefined;
    if (!w) return;

    const onError = (e: ErrorEvent) => {
      this.captureException(e.error ?? new Error(e.message), { url: e.filename ?? undefined });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      this.captureException(e.reason ?? new Error('Unhandled promise rejection'));
    };
    const onHide = () => this.beacon();

    w.addEventListener('error', onError);
    w.addEventListener('unhandledrejection', onRejection);
    w.addEventListener('pagehide', onHide);
    this.detach.push(
      () => w.removeEventListener('error', onError),
      () => w.removeEventListener('unhandledrejection', onRejection),
      () => w.removeEventListener('pagehide', onHide),
    );
  }

  /** Detach all listeners and stop the flush timer. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const d of this.detach) d();
    this.detach = [];
  }
}

// ── Module-level singleton convenience API (the `init()` snippet path) ────────

let singleton: QualityClient | null = null;

/** Initialize the global client. Returns it for advanced use. */
export function init(options: QualityClientOptions): QualityClient {
  singleton?.close();
  singleton = new QualityClient(options);
  return singleton;
}

/** Capture via the global client (no-op + warn if `init` wasn't called). */
export function captureException(err: unknown, ctx?: CaptureContext): void {
  if (!singleton) { warnUninit(); return; }
  singleton.captureException(err, ctx);
}

export function captureMessage(message: string, ctx?: CaptureContext): void {
  if (!singleton) { warnUninit(); return; }
  singleton.captureMessage(message, ctx);
}

export function flush(): Promise<void> {
  return singleton ? singleton.flush() : Promise.resolve();
}

function warnUninit(): void {
  if (typeof console !== 'undefined') console.warn('builderforce-quality: call init({ key, endpoint }) before capturing');
}
