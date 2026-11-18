/**
 * Load the live preview at ONE viewport size in a hidden frame and ask the injected
 * probe (`probeScript.ts`) what is on screen.
 *
 * A separate frame per width, rather than resizing the one the person is looking at:
 * the review must not reflow, scroll or reload the preview under the user, and a fresh
 * load is also the honest test — it is what a visitor at that width gets, not the
 * visible frame's state after an hour of hot reloads. The frame transport itself is
 * `askPreviewFrame` (shared with the preview capture).
 */

import { PREVIEW_PROBE_REQUEST } from './probeScript';
import { probeResultFrom, type ProbeReport } from './probeReport';
import { askPreviewFrame } from './previewFrameRequest';

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
  return askPreviewFrame<ProbeReport>({
    url: probeUrl(request.previewUrl, request.path),
    width: request.width,
    height: request.height,
    title: 'preview-review-probe',
    message: { type: PREVIEW_PROBE_REQUEST, selectors: request.selectors },
    parse: (data, id) => {
      const result = probeResultFrom(data, id);
      if (!result) return undefined;
      return 'error' in result ? { ok: false, error: result.error } : { ok: true, value: result };
    },
    timeoutMs: request.timeoutMs,
    timeoutMessage:
      'The preview did not answer the review probe in time. Press Run to restart the preview (the probe is added when it starts), then inspect again.',
  }, 'The preview probe failed inside the page');
}
