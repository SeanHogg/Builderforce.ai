/**
 * Cloudflare Workers AI image-generation vendor module.
 *
 * Runs on the platform's own Workers AI account — the same
 * `CLOUDFLARE_AI_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` pair the chat vendor uses —
 * so the daily free neuron allowance pays for the FREE entries below before any
 * metered vendor is touched.
 *
 * Endpoint: `POST /accounts/<id>/ai/run/<model>` (the native endpoint — image
 * models are not on the OpenAI-compatible surface). The response shape differs
 * per model family, which {@link readImageBody} absorbs:
 *   - Flux Schnell / Lucid Origin → JSON `{ result: { image: "<base64>" } }`
 *   - SDXL Lightning / DreamShaper LCM / Phoenix → raw `image/png|jpeg` bytes
 *
 * Input differs too: Flux Schnell takes no width/height (always 1024²) and caps
 * `steps` at 8; the SD-family models take `width`/`height` in [256, 2048].
 */

import {
  VendorFatalError,
  executeImageGeneration,
  imageResultFromBase64,
  noImageError,
  parseImageSize,
  type ImageBody,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

/** How a model takes its output size. `none` = fixed-size model (Flux Schnell). */
type SizeInput = 'dims' | 'none';

interface CloudflareImageModel extends ImageVendorModelEntry {
  sizeInput: SizeInput;
}

/**
 * Ids verified against the Workers AI text-to-image catalog. FREE entries are
 * the light models the daily neuron allowance covers comfortably; Leonardo's
 * models cost several times more neurons per image, so they sit in the paid
 * (Pro) pool where a metered overage is acceptable.
 */
const CATALOG: ReadonlyArray<CloudflareImageModel> = [
  { id: '@cf/black-forest-labs/flux-1-schnell',       tier: 'FREE',     label: 'Flux Schnell (Cloudflare)',        brand: 'Black Forest Labs', sizeInput: 'none' },
  { id: '@cf/bytedance/stable-diffusion-xl-lightning', tier: 'FREE',     label: 'SDXL Lightning (Cloudflare)',      brand: 'ByteDance',         sizeInput: 'dims' },
  { id: '@cf/lykon/dreamshaper-8-lcm',                 tier: 'FREE',     label: 'DreamShaper 8 LCM (Cloudflare)',   brand: 'Lykon',             sizeInput: 'dims' },
  { id: '@cf/leonardo/lucid-origin',                   tier: 'STANDARD', label: 'Lucid Origin (Cloudflare)',        brand: 'Leonardo',          sizeInput: 'dims' },
  { id: '@cf/leonardo/phoenix-1.0',                    tier: 'STANDARD', label: 'Phoenix 1.0 (Cloudflare)',         brand: 'Leonardo',          sizeInput: 'dims' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForCloudflareImageModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

/** Workers AI SD-family bounds: each side in [256, 2048], a multiple of 64. */
function clampSide(px: number): number {
  return Math.min(2048, Math.max(256, Math.round(px / 64) * 64));
}

export function buildCloudflareImageBody(params: ImageGenParams): Record<string, unknown> {
  const entry = CATALOG_BY_ID.get(params.model);
  const dim = entry?.sizeInput === 'dims' ? parseImageSize(params.size) : undefined;
  return {
    prompt: params.prompt,
    // Flux Schnell's ceiling is 8 steps; 4 is its distilled sweet spot.
    ...(entry?.sizeInput === 'none' ? { steps: 4 } : {}),
    ...(dim ? { width: clampSide(dim.width), height: clampSide(dim.height) } : {}),
    ...(params.extraBody ?? {}),
  };
}

export function parseCloudflareImageBody(
  model: string,
  body: ImageBody,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  if (body.kind === 'bytes') return imageResultFromBase64(model, body.base64, body.mimeType, responseFormat);
  const result = (body.raw as { result?: { image?: unknown } } | null)?.result;
  const image = typeof result?.image === 'string' ? result.image : '';
  if (!image) throw noImageError('cloudflare', model);
  // Flux Schnell and Lucid Origin encode JPEG.
  return imageResultFromBase64(model, image, 'image/jpeg', responseFormat);
}

export const cloudflareImageModule: ImageVendorModule = {
  id: 'cloudflare',
  catalog: CATALOG,
  tierFor: tierForCloudflareImageModel,
  apiKeyFrom(env) {
    // Same `<token>::<accountId>` sentinel the chat Cloudflare vendor composes —
    // both halves are required, so either missing reads as "unbound".
    const token = env.CLOUDFLARE_AI_API_TOKEN ?? null;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? null;
    return token && accountId ? `${token}::${accountId}` : null;
  },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    const [token, accountId] = params.apiKey.split('::');
    if (!token || !accountId) {
      throw new VendorFatalError('cloudflare', 500, 'malformed cloudflare apiKey sentinel (expected "<token>::<accountId>")');
    }
    return executeImageGeneration({
      vendorId: 'cloudflare',
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${params.model}`,
      apiKey: token,
      model: params.model,
      body: buildCloudflareImageBody(params),
      binary: true,
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseCloudflareImageBody(params.model, raw as ImageBody, params.responseFormat),
    });
  },
};
