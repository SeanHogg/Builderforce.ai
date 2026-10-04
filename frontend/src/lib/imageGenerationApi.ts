import { apiRequest } from './apiClient';

/**
 * THE client for AI image generation — `POST /llm/v1/images/generations`.
 *
 * The gateway owns vendor choice (free Cloudflare / Together / Hugging Face /
 * Pollinations first, paid Gemini / FluxAPI after) and stores byte-producing
 * vendors' output in the tenant asset store, so the `url` returned here is
 * either the vendor's hosted image or a durable `/api/assets/…` link — never
 * something a caller has to persist itself. The canvas image tool and the
 * Studio workspace's `generate_image_asset` action both call this; neither
 * builds the request on its own.
 */

/** OpenAI-compatible sizes every vendor in the cascade maps cleanly. */
export const IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface GeneratedImage {
  url: string;
  /** The model that served it, e.g. `cloudflare/@cf/black-forest-labs/flux-1-schnell`. */
  model?: string;
  /** The vendor that served it, e.g. `cloudflare`. */
  vendor?: string;
  /** The vendor's own rewrite of the prompt, when it made one. */
  revisedPrompt?: string;
}

interface GenerateResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  model?: string;
  _builderforce?: { resolvedModel?: string; resolvedVendor?: string };
}

export function isImageSize(value: unknown): value is ImageSize {
  return typeof value === 'string' && (IMAGE_SIZES as readonly string[]).includes(value);
}

/** Generate one image. Throws the gateway's own message on a refusal (out of
 *  image credits, every vendor saturated) — that sentence is actionable. */
export async function generateImage(args: { prompt: string; size?: ImageSize; useCase: string }): Promise<GeneratedImage> {
  const response = await apiRequest<GenerateResponse>('/llm/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: args.prompt, n: 1, size: args.size ?? '1024x1024', response_format: 'url', useCase: args.useCase }),
  });
  const first = response.data[0];
  const url = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : '');
  if (!url) throw new Error('The image generator returned no image');
  return {
    url,
    model: response._builderforce?.resolvedModel ?? response.model,
    vendor: response._builderforce?.resolvedVendor,
    revisedPrompt: first?.revised_prompt,
  };
}
