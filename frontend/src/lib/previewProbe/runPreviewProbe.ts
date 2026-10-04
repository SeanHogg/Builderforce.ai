/**
 * Load the live preview at ONE viewport size in a hidden frame and ask the injected
 * probe (`probeScript.ts`) what is on screen.
 *
 * A separate frame per width, rather than resizing the one the person is looking at:
 * the review must not reflow, scroll or reload the preview under the user, and a fresh
 * load is also the honest test — it is what a visitor at that width gets, not the
 * visible frame's state after an hour of hot reloads.
 *
 * The frame is parked off-screen at its real size (not `display: none`, which has no
 * layout to measure). The request is re-posted until answered, because "the app has
 * booted and the probe is listening" has no event the host can observe across origins.
 */

import { PREVIEW_PROBE_REQUEST } from './probeScript';
import { probeResultFrom, type ProbeReport } from './probeReport';

export interface PreviewProbeRequest {
  /** The running preview's URL (instant runtime or dev server). */
  previewUrl: string;
  /** In-app path or hash to load, e.g. `/pricing` or `#characters`. */
  path?: string;
  width: number;
  height: number;
  /** CSS selectors to measure in detail. */
  selectors: string[];
  /** Give up after this long. */
  timeoutMs?: number;
}

const RETRY_MS = 400;
const SETTLE_MS = 600;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Resolve `path` against the preview URL; a bare `#hash` keeps the page and adds the fragment. */
export function probeUrl(previewUrl: string, path?: string): string {
  const target = (path ?? '').trim();
  if (!target) return previewUrl;
  try {
    return new URL(target, previewUrl).toString();
  } catch {
    return previewUrl;
  }
}

export function runPreviewProbe(request: PreviewProbeRequest): Promise<ProbeReport> {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'preview-review-probe';
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${request.width}px;height:${request.height}px;border:0;pointer-events:none;`;

  return new Promise<ProbeReport>((resolve, reject) => {
    let retry: number | undefined;
    let settle: number | undefined;
    const finish = (outcome: () => void) => {
      window.clearTimeout(settle);
      window.clearInterval(retry);
      window.clearTimeout(deadline);
      window.removeEventListener('message', onMessage);
      frame.remove();
      outcome();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const result = probeResultFrom(event.data, id);
      if (!result) return;
      if ('error' in result) finish(() => reject(new Error(`The preview probe failed inside the page: ${result.error}`)));
      else finish(() => resolve(result));
    };
    const deadline = window.setTimeout(() => finish(() => reject(new Error(
      'The preview did not answer the review probe in time. Press Run to restart the preview (the probe is added when it starts), then inspect again.',
    ))), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const ask = () => frame.contentWindow?.postMessage({ type: PREVIEW_PROBE_REQUEST, id, selectors: request.selectors }, '*');

    window.addEventListener('message', onMessage);
    // `load` fires once the entry modules have run, but the first render and any
    // mount-time effects land just after it — measuring at `load` reviews a half-drawn page.
    frame.addEventListener('load', () => {
      settle = window.setTimeout(() => {
        ask();
        retry = window.setInterval(ask, RETRY_MS);
      }, SETTLE_MS);
    }, { once: true });
    frame.src = probeUrl(request.previewUrl, request.path);
    document.body.appendChild(frame);
  });
}
