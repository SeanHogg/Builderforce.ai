import type { BrainAction } from '@/lib/brain';
import { IMAGE_SIZES } from '@/lib/imageGenerationApi';
import { generateReviewedMedia } from './media/reviewedMediaGeneration';
import { shapeFromImageSize } from './media/mediaRequest';
import type { MediaStudioPort } from './media/useMediaStudio';

/**
 * `generate_image_asset` — the Studio builder's way to put a REAL picture in the
 * app it is building.
 *
 * Without it, a "landing page for my bakery" got a hero `<img>` pointing at a
 * placeholder service or an invented Unsplash URL that 404s. Project files are
 * text, so the image is not written into the project: the gateway generates it
 * and stores it, and the action hands back a durable public URL the model drops
 * into `src`, a CSS `background-image`, or an OG tag.
 *
 * The person sees it FIRST: the image opens in the Media panel and the tool waits
 * for "Use it", "Try again" or "Discard" (`generateReviewedMedia`). Only a used
 * image's URL comes back to the model.
 */
export function generateImageAssetAction(media: MediaStudioPort): BrainAction {
  return {
    name: 'generate_image_asset',
    description:
      'Generate an original image with AI (hero art, illustrations, product shots, backgrounds) and get back a public URL to use in the project — as an <img src>, a CSS background-image, or a social preview. ' +
      'The user previews it in the Media panel first and decides to use it, try again or discard it; only write the URL into the code when this tool returns one. ' +
      'Describe the subject, style, colours and composition in the prompt. Use this instead of placeholder-image services or guessed stock-photo URLs.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image shows and how it looks — subject, style, palette, lighting, composition.' },
        size: { type: 'string', enum: [...IMAGE_SIZES], description: 'Square 1024x1024 (default), landscape 1792x1024 (hero/banner) or portrait 1024x1792.' },
      },
      required: ['prompt'],
    },
    run: async ({ prompt, size }: { prompt?: unknown; size?: unknown }) => {
      const text = typeof prompt === 'string' ? prompt.trim() : '';
      if (!text) return { error: 'A prompt describing the image is required.' };
      const result = await generateReviewedMedia(media, { kind: 'image', prompt: text, shape: shapeFromImageSize(size) });
      if (!result.ok) return 'error' in result ? { error: result.error } : { declined: true, note: result.note };
      return { url: result.item.url, model: result.item.model, note: 'The user chose this image. Reference this URL directly in the project code.' };
    },
  };
}
