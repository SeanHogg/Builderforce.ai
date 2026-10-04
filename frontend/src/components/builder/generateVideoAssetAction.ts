import type { BrainAction } from '@/lib/brain';
import { generateVideoClip, isVideoAspectRatio } from '@/lib/videoGenerationApi';
import { CLOUD_SHOT_SECONDS, snapShotSeconds } from '@/lib/sceneStoryboard';
import { toolErrorMessage } from '@/lib/toolErrorMessage';

/**
 * `generate_video_asset` — the Studio builder's way to put a REAL video in the
 * app it is building: a hero loop, a product demo shot, a background clip.
 *
 * Twin of `generate_image_asset` and for the same reason: without it a "landing
 * page with a video hero" got a `<video>` pointing at a sample-video URL that
 * 404s. The gateway renders the clip, stores it in the tenant asset store and the
 * action hands back a durable public URL for `<video src>` — one that works in the
 * live preview and after the app is deployed.
 */
/** `generate` is injectable so the action is testable without module mocks;
 *  every real caller uses the default gateway client. */
export function generateVideoAssetAction(generate: typeof generateVideoClip = generateVideoClip): BrainAction {
  return {
    name: 'generate_video_asset',
    description:
      'Generate an original short video clip with AI (hero loops, product shots, ambient backgrounds) and get back a public MP4 URL to use in the project — as a <video src> (add autoplay muted loop playsinline for a background). ' +
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
      try {
        const { job, source } = await generate({
          prompt: text,
          durationSeconds: snapShotSeconds(typeof durationSeconds === 'number' ? durationSeconds : 5),
          ...(isVideoAspectRatio(aspectRatio) ? { aspectRatio } : {}),
          useCase: 'studio_video_asset',
        });
        return {
          url: source.url,
          mimeType: source.mimeType,
          durationSeconds: source.durationSeconds,
          model: job.result?.model,
          note: 'Reference this URL directly in the project code, e.g. <video src="…" autoplay muted loop playsinline>.',
        };
      } catch (e) {
        return { error: toolErrorMessage(e, 'Video generation failed') };
      }
    },
  };
}
