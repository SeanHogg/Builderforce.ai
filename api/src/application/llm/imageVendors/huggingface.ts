/**
 * Hugging Face Inference Providers image-generation vendor module.
 *
 * Routed through HF's provider router to the **nscale** provider's OpenAI-compatible
 * images endpoint:
 *
 *   POST https://router.huggingface.co/nscale/v1/images/generations
 *   { model, prompt, response_format: 'b64_json', n, size? }  →  { data: [{ b64_json }] }
 *
 * Why not `hf-inference` any more: since 2026-10 HF's own serverless provider answers
 * `410 The requested model is deprecated and no longer supported by provider
 * hf-inference` for both FLUX.1-schnell and SDXL base. HF's live provider mapping
 * (checked 2026-10-10) serves FLUX.1-schnell on `nscale` (provider id =
 * the hub id) and `fal-ai`; SDXL base only on `fal-ai`, whose request/response shape is
 * different again — so SDXL is dropped from this catalog rather than given a second
 * transport. Cloudflare and Pollinations still serve SDXL-family models.
 *
 * Authenticates with an `hf_*` token (`HF_API_TOKEN`); HF bills the provider call to the
 * account's credit. A credit-exhausted account answers 402 ("You have no remaining
 * credits"), which the shared transport raises as a RETRYABLE 402 — a capacity/payment
 * failure the cascade and the health probe classify as such, never a malformed response.
 */

import {
  executeImageGeneration,
  imageResultFromBase64,
  noImageError,
  parseImageSize,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

/** The HF router path of the provider this vendor rides. */
export const HUGGING_FACE_IMAGE_ENDPOINT = 'https://router.huggingface.co/nscale/v1/images/generations';

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  // nscale's provider id for this model is the hub id itself.
  { id: 'black-forest-labs/FLUX.1-schnell', tier: 'FREE', label: 'Flux Schnell (Hugging Face)', brand: 'Black Forest Labs' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForHuggingFaceModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

export function buildHuggingFaceImageBody(params: ImageGenParams): Record<string, unknown> {
  const dim = parseImageSize(params.size);
  return {
    model: params.model,
    prompt: params.prompt,
    // Always base64: the router answers inline, and the gateway persists `data:` URLs
    // itself (see `persistGeneratedImages`) — a provider-hosted URL would expire.
    response_format: 'b64_json',
    n: params.n ?? 1,
    ...(dim ? { size: `${dim.width}x${dim.height}` } : {}),
    ...(params.extraBody ?? {}),
  };
}

/** PNG and JPEG are told apart by their base64 magic prefix; the endpoint does not say. */
function mimeTypeOfBase64(base64: string): string {
  return base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
}

export function parseHuggingFaceImageResponse(
  model: string,
  raw: unknown,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  const rows = (raw as { data?: Array<{ b64_json?: unknown }> } | null)?.data;
  const images = Array.isArray(rows)
    ? rows.map((d) => d?.b64_json).filter((b): b is string => typeof b === 'string' && b.length > 0)
    : [];
  if (images.length === 0) throw noImageError('huggingface', model);
  const results = images.map((b64) => imageResultFromBase64(model, b64, mimeTypeOfBase64(b64), responseFormat));
  return { ...results[0]!, data: results.flatMap((r) => r.data) };
}

export const huggingFaceImageModule: ImageVendorModule = {
  id: 'huggingface',
  catalog: CATALOG,
  tierFor: tierForHuggingFaceModel,
  apiKeyFrom(env) { return env.HF_API_TOKEN ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'huggingface',
      endpoint: HUGGING_FACE_IMAGE_ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildHuggingFaceImageBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseHuggingFaceImageResponse(params.model, raw, params.responseFormat),
    });
  },
};
