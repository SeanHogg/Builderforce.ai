import type { CanvasViewport } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';

/**
 * The three ways real pixels reach the canvas.
 *
 * `capture` is the newest and closes a hole the other two could not. A redesign
 * conversation ("upgrade my site, show me a before and after") needs pixels of a page
 * that ALREADY EXISTS, and neither searching stock photography nor generating an
 * illustration can produce those — so the canvas had no honest answer and the model
 * invented one: "as a large language model, I don't have the ability to browse the web
 * visually or take screenshots of live websites." See `api/src/application/web/
 * webScreenshot.ts` for the measured session.
 *
 * It is NOT a fourth value of {@link CanvasImageResolveMode}: that type is what the
 * model chooses between when it wants a picture OF something, and every arm of it takes
 * a free-text query. A capture takes a URL, which is a different input and a different
 * tool — see `CANVAS_SCREENSHOT_TOOL`.
 */
export type CanvasImageResolveMode = 'find' | 'generate' | 'auto';

export type CanvasImageSource = 'stock' | 'ai' | 'capture';

export interface CanvasImageAsset {
  url: string;
  thumbnailUrl: string;
  provider: string;
  source: CanvasImageSource;
  title?: string;
  author?: string;
  authorUrl?: string;
  licence?: string;
  width?: number;
  height?: number;
  model?: string;
  /** `capture` only: the live page these pixels are of, and when they were taken. A
   *  "before" with no address and no date is a picture, not evidence. */
  capturedUrl?: string;
  capturedAt?: string;
  capturedViewport?: CanvasViewport;
}

interface SearchResponse { results: Array<CanvasImageAsset & { providerAssetId: string }> }
interface GenerateResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  model?: string;
  _builderforce?: { resolvedModel?: string; resolvedVendor?: string };
}

interface ScreenshotResponse {
  url: string;
  imageDataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  viewport: CanvasViewport;
  capturedAt: string;
  provider: string;
}

export async function findCanvasImage(query: string): Promise<CanvasImageAsset | null> {
  const response = await apiRequest<SearchResponse>(`/api/creative/images/search?q=${encodeURIComponent(query)}&limit=12`);
  const result = response.results[0];
  return result ? { ...result, source: 'stock' } : null;
}

export async function generateCanvasImage(prompt: string): Promise<CanvasImageAsset> {
  const response = await apiRequest<GenerateResponse>('/llm/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, n: 1, size: '1024x1024', response_format: 'url', useCase: 'canvas_image_create' }),
  });
  const first = response.data[0];
  const url = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : '');
  if (!url) throw new Error('The image generator returned no image');
  return {
    url, thumbnailUrl: url, source: 'ai',
    provider: response._builderforce?.resolvedVendor ?? 'builderforce-image',
    model: response._builderforce?.resolvedModel ?? response.model,
    title: first?.revised_prompt,
  };
}

/**
 * Photograph a LIVE page — the "before" a redesign is compared against.
 *
 * The gateway drives a real remote browser (see `application/web/webScreenshot.ts`), so
 * a JS-rendered marketing site captures as its visitors see it rather than as its HTML
 * source reads. Every refusal from that service carries the true reason in its message,
 * and this rethrows it unchanged: the whole point of the capability is that the user
 * hears "that page took too long to render" or "capture is not configured on this
 * deployment" instead of a limitation the model made up.
 */
export async function captureCanvasScreenshot(
  url: string,
  viewport: CanvasViewport = 'desktop',
  fullPage = false,
): Promise<CanvasImageAsset> {
  const shot = await apiRequest<ScreenshotResponse>('/api/creative/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, viewport, fullPage }),
  });
  if (!shot.imageDataUrl) throw new Error('The page renderer returned no image');
  return {
    url: shot.imageDataUrl,
    thumbnailUrl: shot.imageDataUrl,
    source: 'capture',
    provider: shot.provider,
    width: shot.width,
    height: shot.height,
    capturedUrl: shot.url,
    capturedAt: shot.capturedAt,
    capturedViewport: shot.viewport,
  };
}

/** Find first for ambiguous requests, then create when search is unavailable or empty. */
export async function resolveCanvasImage(query: string, mode: CanvasImageResolveMode): Promise<CanvasImageAsset> {
  if (mode === 'generate') return generateCanvasImage(query);
  if (mode === 'find') {
    const found = await findCanvasImage(query);
    if (!found) throw new Error('No matching stock image was found');
    return found;
  }
  try {
    const found = await findCanvasImage(query);
    if (found) return found;
  } catch { /* A missing stock-provider configuration should fall through to generation. */ }
  return generateCanvasImage(query);
}
