/**
 * Capture a running browser preview as an image: load it in a hidden frame at the
 * viewport's size and ask the page's capture script (`captureScript.ts`) to render
 * itself — over the shared preview-frame transport (`askPreviewFrame`).
 */
import { CANVAS_VIEWPORT_CAPTURE_HEIGHTS, CANVAS_VIEWPORT_WIDTHS, type CanvasViewport } from '@builderforce/creation-canvas-contract';
import { askPreviewFrame } from '@/lib/previewProbe/previewFrameRequest';
import { PREVIEW_CAPTURE_REQUEST, PREVIEW_CAPTURE_RESULT, PREVIEW_CAPTURE_UNSUPPORTED } from './captureScript';

export interface PreviewCapture {
  imageDataUrl: string;
  width: number;
  height: number;
  url: string;
}

/** The largest capture accepted (characters of the data URL). */
export const MAX_CAPTURE_CHARS = 4 * 1024 * 1024;

/** Only these images are accepted from the page — never SVG (script) or anything else. */
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

/** What a browser that refuses to read back a rendered page is told. */
export const CAPTURE_UNSUPPORTED =
  'Screenshots of a browser preview are not supported in this browser: it refuses to read back a rendered page. '
  + 'Use Chrome, Edge or Firefox, or read preview_logs instead.';

/** The capture for request `id`, its in-page failure, or undefined for any other message. */
export function captureResultFrom(data: unknown, id: string): { ok: true; value: PreviewCapture } | { ok: false; error: string } | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const envelope = data as { type?: unknown; id?: unknown; result?: unknown };
  if (envelope.type !== PREVIEW_CAPTURE_RESULT || envelope.id !== id) return undefined;
  const raw = (envelope.result && typeof envelope.result === 'object' ? envelope.result : {}) as Record<string, unknown>;
  if (raw.error === PREVIEW_CAPTURE_UNSUPPORTED) return { ok: false, error: CAPTURE_UNSUPPORTED };
  if (typeof raw.error === 'string') return { ok: false, error: raw.error.slice(0, 500) };
  if (typeof raw.imageDataUrl !== 'string') return { ok: false, error: 'the page answered without an image' };
  if (raw.imageDataUrl.length > MAX_CAPTURE_CHARS) return { ok: false, error: 'the capture was larger than a screenshot may be' };
  if (!IMAGE_DATA_URL.test(raw.imageDataUrl)) return { ok: false, error: 'the page answered with something other than a JPEG or PNG image' };
  return {
    ok: true,
    value: {
      imageDataUrl: raw.imageDataUrl,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      url: typeof raw.url === 'string' ? raw.url : '',
    },
  };
}

export function capturePreview(url: string, viewport: CanvasViewport = 'desktop'): Promise<PreviewCapture> {
  return askPreviewFrame<PreviewCapture>({
    url,
    width: CANVAS_VIEWPORT_WIDTHS[viewport],
    height: CANVAS_VIEWPORT_CAPTURE_HEIGHTS[viewport],
    title: 'preview-capture',
    message: { type: PREVIEW_CAPTURE_REQUEST },
    parse: captureResultFrom,
    timeoutMs: 20_000,
    timeoutMessage: 'The preview did not answer the capture in time. Restart the preview (the capture is added when the browser run starts) and try again.',
  }, 'The preview capture failed inside the page');
}
