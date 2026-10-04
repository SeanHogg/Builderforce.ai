/**
 * Validate a caller's clip parameters into a `VideoClipRequest` — the defaults
 * (5 seconds, landscape) and the SSRF guard on a first-frame URL, which the
 * vendor (or, for Veo, this Worker) will fetch.
 */

import { assertSafeUrl } from '../../../infrastructure/net/ssrfGuard';
import { isVideoAspectRatio, type VideoClipRequest } from '../videoVendors/types';

/** Default clip length — the cheapest model's only length, and a natural shot. */
export const DEFAULT_CLIP_SECONDS = 5;

export type ClipRequestBuild = { ok: true; request: VideoClipRequest } | { ok: false; error: string };

export function buildClipRequest(input: {
  prompt: string;
  duration?: number | undefined;
  aspectRatio?: string | undefined;
  imageUrl?: string | undefined;
  seed?: number | undefined;
}): ClipRequestBuild {
  let imageUrl: string | undefined;
  if (input.imageUrl) {
    try {
      imageUrl = assertSafeUrl(input.imageUrl).toString();
    } catch (error) {
      return { ok: false, error: `image_url: ${error instanceof Error ? error.message : 'invalid URL'}` };
    }
  }
  return {
    ok: true,
    request: {
      prompt: input.prompt,
      durationSeconds: input.duration ?? DEFAULT_CLIP_SECONDS,
      aspectRatio: isVideoAspectRatio(input.aspectRatio) ? input.aspectRatio : '16:9',
      ...(imageUrl ? { imageUrl } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    },
  };
}
