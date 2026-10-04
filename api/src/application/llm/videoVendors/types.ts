/**
 * Video-generation vendor types.
 *
 * Video differs from images in one way that shapes everything here: a clip
 * takes from 30 seconds to several minutes, longer than a request should wait.
 * So a vendor exposes TWO steps instead of one `generate`:
 *   - `start`  — begin a clip; returns the finished bytes when the vendor
 *                answers synchronously (Pollinations), or a `pending` handle
 *                (Gemini Veo's long-running operation)
 *   - `poll`   — advance a pending handle; same result shape
 * The media job runner (`application/llm/video/mediaJob.ts`) drives those steps
 * from a Durable Object alarm, so no HTTP request ever waits on a clip.
 *
 * Error classification is the shared one (`VendorRetryableError` cascades to
 * the next model, `VendorFatalError` fails the job), as is the registry
 * (`../mediaVendorRegistry.ts`).
 */

import {
  CASCADE_STATUSES,
  VendorFatalError,
  VendorRetryableError,
  fetchWithVendorTimeout,
} from '../vendors/types';
import type { MediaModelEntry, MediaVendorModuleBase } from '../mediaVendorRegistry';

export { VendorFatalError, VendorRetryableError };

export type VideoVendorId = 'pollinations' | 'googleai';

export interface VideoVendorEnv {
  POLLINATIONS_API_KEY?: string | null;
  GOOGLE_API_KEY?: string | null;
}

/** The aspect ratios every vendor in the cascade can honour (or clamp to). */
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export function isVideoAspectRatio(value: unknown): value is VideoAspectRatio {
  return typeof value === 'string' && (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value);
}

export interface VideoClipRequest {
  prompt: string;
  /** Requested length; each model clamps to what it supports ({@link VideoModelEntry}). */
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  /** Optional first frame — keeps a character or a look consistent across shots. */
  imageUrl?: string;
  seed?: number;
}

export interface VideoStartParams extends VideoClipRequest {
  apiKey: string;
  /** Vendor-native model id. */
  model: string;
  timeoutMs?: number;
}

export type VideoStepResult =
  | { kind: 'done'; bytes: ArrayBuffer; mimeType: string }
  | { kind: 'pending'; handle: string; retryAfterMs: number };

/** A catalog entry plus the clip lengths the model accepts. */
export interface VideoModelEntry extends MediaModelEntry {
  /** Allowed lengths in seconds, ascending. A request clamps to the nearest. */
  durations: readonly number[];
}

export interface VideoVendorModule extends MediaVendorModuleBase<VideoVendorId, VideoVendorEnv> {
  catalog: ReadonlyArray<VideoModelEntry>;
  start(params: VideoStartParams): Promise<VideoStepResult>;
  poll(params: { apiKey: string; model: string; handle: string; timeoutMs?: number }): Promise<VideoStepResult>;
}

/**
 * Per-call deadline for a video vendor request. Pollinations holds the
 * connection open while it renders, so this is minutes, not the image surface's
 * 45s. It runs inside a Durable Object alarm (15-minute wall limit), never a
 * user-facing request.
 */
export const DEFAULT_VIDEO_VENDOR_CALL_TIMEOUT_MS = 5 * 60_000;

/** The length a model will actually render for a requested length: the nearest
 *  allowed value, ties going to the shorter (cheaper) one. */
export function clampVideoDuration(entry: Pick<VideoModelEntry, 'durations'>, requested: number): number {
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : entry.durations[0]!;
  let best = entry.durations[0]!;
  for (const d of entry.durations) {
    if (Math.abs(d - wanted) < Math.abs(best - wanted)) best = d;
  }
  return best;
}

/**
 * Fetch a vendor URL and return the video bytes, classifying failures the same
 * way every other vendor call is classified. A JSON body on a 2xx is a vendor
 * that answered without a video — retryable, so the cascade moves on.
 */
export async function fetchVideoBytes(args: {
  vendorId: VideoVendorId;
  model: string;
  url: string;
  init: RequestInit;
  timeoutMs?: number;
}): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const { vendorId, model, url, init } = args;
  const resp = await fetchWithVendorTimeout(vendorId, model, url, init, args.timeoutMs ?? DEFAULT_VIDEO_VENDOR_CALL_TIMEOUT_MS);
  if (!resp.ok) throw classifyVideoFailure(vendorId, model, resp.status, (await resp.text()).slice(0, 300));
  const mimeType = (resp.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!mimeType.startsWith('video/')) {
    throw new VendorRetryableError(vendorId, model, 502, `embedded:empty: ${vendorId} returned ${mimeType || 'no content type'} instead of a video`);
  }
  return { bytes: await resp.arrayBuffer(), mimeType };
}

/**
 * The status → error mapping for video vendors. Cascade statuses, auth
 * failures and 402 (this vendor's balance is spent) all move on to the next
 * model; anything else (a 400 for a prompt the vendor refuses) fails the job,
 * because every other vendor would refuse the same prompt.
 */
export function classifyVideoFailure(vendorId: VideoVendorId, model: string, status: number, detail: string): Error {
  if (CASCADE_STATUSES.has(status) || status === 401 || status === 403 || status === 402) {
    return new VendorRetryableError(vendorId, model, status, detail);
  }
  return new VendorFatalError(vendorId, status, detail);
}
