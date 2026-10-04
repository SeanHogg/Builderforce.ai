import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { reportBackgroundFailure } from '@/lib/reportError';
import type { ProjectMediaItem } from '@/lib/projectMediaApi';
import type { MediaRequest } from './mediaRequest';
import type { MediaStudioPort } from './useMediaStudio';

/** "Try again" rounds before the tool hands the question back to the agent. */
export const MAX_MEDIA_ATTEMPTS = 4;

export type ReviewedMediaResult =
  | { ok: true; item: ProjectMediaItem }
  | { ok: false; declined: true; note: string }
  | { ok: false; error: string };

/**
 * Generate → show it in the Media panel → wait for the person — the ONE loop
 * behind `generate_image_asset` and `generate_video_asset`.
 *
 * "Try again" regenerates (with the prompt as the person edited it) without
 * going back through the model; "Discard" ends the tool with a decline the
 * model must respect; "Use it" marks the asset used and returns it, and only
 * then does the model write its URL into the code.
 */
export async function generateReviewedMedia(port: MediaStudioPort, request: MediaRequest): Promise<ReviewedMediaResult> {
  let next = request;
  for (let attempt = 1; attempt <= MAX_MEDIA_ATTEMPTS; attempt++) {
    let item: ProjectMediaItem;
    try {
      item = await port.generate(next);
    } catch (error) {
      return { ok: false, error: toolErrorMessage(error, `${request.kind === 'image' ? 'Image' : 'Video'} generation failed`) };
    }
    const decision = await port.review(item);
    if (decision.action === 'use') {
      // The "in app" badge is bookkeeping: failing it must not undo the person's choice.
      await port.markUsed(item.id).catch((error: unknown) => {
        void reportBackgroundFailure({ message: toolErrorMessage(error, 'Marking a media item used failed'), level: 'warning', context: { mediaId: item.id } });
      });
      return { ok: true, item };
    }
    if (decision.action === 'discard') {
      return { ok: false, declined: true, note: `The user discarded the ${request.kind}. Do not use it or put a placeholder in its place; ask what they would like instead.` };
    }
    next = { ...next, prompt: decision.prompt.trim() || next.prompt };
  }
  return { ok: false, declined: true, note: `The user tried ${MAX_MEDIA_ATTEMPTS} versions and accepted none. Ask how the ${request.kind} should differ before generating again.` };
}
