import type { BrainAction } from '@/lib/brain';
import { CLOUD_SHOT_SECONDS, snapShotSeconds } from '@/lib/sceneStoryboard';
import { generateReviewedMedia } from './media/reviewedMediaGeneration';
import { shapeFromAspect } from './media/mediaRequest';
import type { MediaStudioPort } from './media/useMediaStudio';

/**
 * `generate_video_asset` — the Studio builder's way to put a REAL video in the
 * app it is building: a hero loop, a product demo shot, a background clip.
 *
 * Twin of `generate_image_asset` and for the same reason: without it a "landing
 * page with a video hero" got a `<video>` pointing at a sample-video URL that
 * 404s. The gateway renders the clip and stores it; the person previews it in the
 * Media panel and decides before the model ever sees the URL.
 */
export function generateVideoAssetAction(media: MediaStudioPort): BrainAction {
  return {
    name: 'generate_video_asset',
    description:
      'Generate an original short video clip with AI (hero loops, product shots, ambient backgrounds) and get back a public MP4 URL to use in the project — as a <video src> (add autoplay muted loop playsinline for a background). ' +
      'The user previews it in the Media panel first and decides to use it, try again or discard it; only write the URL into the code when this tool returns one. ' +
      'Describe the subject, motion, setting, light and camera move in the prompt. Takes from half a minute to a few minutes. Use this instead of sample-video URLs.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the clip shows and how it moves — subject, action, setting, lighting, camera.' },
        durationSeconds: { type: 'number', enum: [...CLOUD_SHOT_SECONDS], description: 'Clip length in seconds. Default 5.' },
        aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Landscape 16:9 (default, hero/banner), vertical 9:16, or square 1:1.' },
      },
      required: ['prompt'],
    },
    run: async ({ prompt, durationSeconds, aspectRatio }: { prompt?: unknown; durationSeconds?: unknown; aspectRatio?: unknown }) => {
      const text = typeof prompt === 'string' ? prompt.trim() : '';
      if (!text) return { error: 'A prompt describing the clip is required.' };
      const result = await generateReviewedMedia(media, {
        kind: 'video',
        prompt: text,
        shape: shapeFromAspect(aspectRatio),
        durationSeconds: snapShotSeconds(typeof durationSeconds === 'number' ? durationSeconds : 5),
      });
      if (!result.ok) return 'error' in result ? { error: result.error } : { declined: true, note: result.note };
      const { item } = result;
      return {
        url: item.url,
        mimeType: item.mimeType,
        durationSeconds: item.durationSeconds,
        model: item.model,
        note: 'The user chose this clip. Reference this URL directly in the project code, e.g. <video src="…" autoplay muted loop playsinline>.',
      };
    },
  };
}
