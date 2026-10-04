import type { BrainAction } from '@/lib/brain';
import { IMAGE_SIZES, generateImage, isImageSize } from '@/lib/imageGenerationApi';
import { toolErrorMessage } from '@/lib/toolErrorMessage';

/**
 * `generate_image_asset` — the Studio builder's way to put a REAL picture in the
 * app it is building.
 *
 * Without it, a "landing page for my bakery" got a hero `<img>` pointing at a
 * placeholder service or an invented Unsplash URL that 404s. Project files are
 * text, so the image is not written into the project: the gateway generates it,
 * stores it in the tenant asset store, and the action hands back a durable public
 * URL the model drops into `src`, a CSS `background-image`, or an OG tag. That
 * URL works in the live preview AND after the app is deployed.
 */
export function generateImageAssetAction(): BrainAction {
  return {
    name: 'generate_image_asset',
    description:
      'Generate an original image with AI (hero art, illustrations, product shots, backgrounds) and get back a public URL to use in the project — as an <img src>, a CSS background-image, or a social preview. ' +
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
      try {
        const image = await generateImage({ prompt: text, size: isImageSize(size) ? size : undefined, useCase: 'studio_image_asset' });
        return { url: image.url, model: image.model, note: 'Reference this URL directly in the project code.' };
      } catch (e) {
        return { error: toolErrorMessage(e, 'Image generation failed') };
      }
    },
  };
}
