/**
 * Pollinations video vendor — `GET https://gen.pollinations.ai/video/<prompt>`.
 *
 * Synchronous: the vendor holds the connection while it renders and answers
 * with `video/mp4`, so `start` returns the finished bytes and `poll` is never
 * reached. `image[0]` is the optional first frame. Authenticated with the same
 * `sk_…` secret key as the image vendor; each clip spends pollen per second.
 *
 * Catalog picked from `GET https://gen.pollinations.ai/video/models`
 * (2026-10-04): the cheapest model as FREE, a 1080p model as STANDARD, and Veo
 * 3.1 Fast as PREMIUM — "cheap first, quality on paid plans".
 */

import {
  VendorFatalError,
  fetchVideoBytes,
  type VideoModelEntry,
  type VideoStartParams,
  type VideoStepResult,
  type VideoVendorModule,
} from './types';
import type { MediaModelTier } from '../mediaVendorRegistry';

const ENDPOINT_BASE = 'https://gen.pollinations.ai/video/';

const CATALOG: ReadonlyArray<VideoModelEntry> = [
  // ~0.01 pollen/s, 480p, up to 5s.
  { id: 'alibaba/wan-2.2-fast',          tier: 'FREE',     label: 'Wan 2.2 Fast (Pollinations)',          brand: 'Alibaba',   durations: [5] },
  // ~0.015–0.06 pollen/s, 1080p, up to 10s.
  { id: 'bytedance/seedance-1-pro-fast', tier: 'STANDARD', label: 'Seedance 1 Pro Fast (Pollinations)',   brand: 'ByteDance', durations: [5, 10] },
  // ~0.08–0.1 pollen/s, 1080p, 4/6/8s.
  { id: 'google/veo-3.1-fast',           tier: 'PREMIUM',  label: 'Veo 3.1 Fast (Pollinations)',          brand: 'Google',    durations: [4, 6, 8] },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

/** The full request URL — prompt in the path, everything else as query params. */
export function pollinationsVideoUrl(params: VideoStartParams): string {
  const query = new URLSearchParams({
    model: params.model,
    duration: String(params.durationSeconds),
    aspectRatio: params.aspectRatio,
    audio: 'false',
    private: 'true',
    ...(params.seed !== undefined ? { seed: String(params.seed) } : {}),
  });
  if (params.imageUrl) query.set('image', params.imageUrl);
  return `${ENDPOINT_BASE}${encodeURIComponent(params.prompt)}?${query.toString()}`;
}

export const pollinationsVideoModule: VideoVendorModule = {
  id: 'pollinations',
  catalog: CATALOG,
  tierFor: (modelId: string): MediaModelTier => CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE',
  apiKeyFrom(env) { return env.POLLINATIONS_API_KEY ?? null; },
  async start(params: VideoStartParams): Promise<VideoStepResult> {
    const { bytes, mimeType } = await fetchVideoBytes({
      vendorId: 'pollinations',
      model: params.model,
      url: pollinationsVideoUrl(params),
      init: { method: 'GET', headers: { Authorization: `Bearer ${params.apiKey}` } },
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });
    return { kind: 'done', bytes, mimeType };
  },
  async poll(): Promise<VideoStepResult> {
    // Synchronous vendor: a pending handle can never have been issued.
    throw new VendorFatalError('pollinations', 500, 'pollinations video has no pending state to poll');
  },
};
