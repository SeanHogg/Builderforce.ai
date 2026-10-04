/**
 * Together.ai image-generation vendor module — free-tier image gen via the
 * OpenAI-compatible `/v1/images/generations` endpoint at api.together.xyz.
 *
 * One of the FREE vendors the image cascade interleaves (with Cloudflare, Hugging
 * Face and Pollinations) before falling through to paid Gemini / FluxAPI.
 *
 * Authenticates with `TOGETHER_API_KEY`.
 */

import {
  executeImageGeneration,
  noImageError,
  parseImageSize,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

const ENDPOINT = 'https://api.together.xyz/v1/images/generations';

/**
 * Free Together image models. `FLUX.1-schnell-Free` is Together's free-tier
 * hosted Flux Schnell. DreamShaper is a competent free SD-style fallback.
 */
const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'black-forest-labs/FLUX.1-schnell-Free', tier: 'FREE', label: 'Flux Schnell (Together · Free)', brand: 'Black Forest Labs' },
  { id: 'Lykon/DreamShaper',                     tier: 'FREE', label: 'DreamShaper (Together · Free)',  brand: 'Lykon' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForTogetherModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

function buildBody(params: ImageGenParams): Record<string, unknown> {
  const dim = parseImageSize(params.size);
  return {
    model: params.model,
    prompt: params.prompt,
    ...(dim ? { width: dim.width, height: dim.height } : {}),
    ...(params.n != null ? { n: params.n } : {}),
    ...(params.responseFormat === 'b64_json' ? { response_format: 'b64_json' } : {}),
    ...(params.extraBody ?? {}),
  };
}

/** Together returns the OpenAI-shaped `{ created, data: [{ url|b64_json|revised_prompt }] }`. */
function parseTogetherResponse(model: string, raw: unknown): ImageGenResult {
  const r = raw as {
    created?: number;
    data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  };
  const data = Array.isArray(r.data) ? r.data : [];
  if (data.length === 0) {
    // 200 OK with no image — treat as retryable so the cascade advances.
    throw noImageError('together', model);
  }
  return {
    created: typeof r.created === 'number' ? r.created : Math.floor(Date.now() / 1000),
    model,
    data: data.map((d) => ({
      ...(d.url ? { url: d.url } : {}),
      ...(d.b64_json ? { b64_json: d.b64_json } : {}),
      ...(d.revised_prompt ? { revised_prompt: d.revised_prompt } : {}),
    })),
  };
}

export const togetherImageModule: ImageVendorModule = {
  id: 'together',
  catalog: CATALOG,
  tierFor: tierForTogetherModel,
  apiKeyFrom(env) { return env.TOGETHER_API_KEY ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'together',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseTogetherResponse(params.model, raw),
    });
  },
};
