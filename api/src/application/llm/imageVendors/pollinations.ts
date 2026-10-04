/**
 * Pollinations image-generation vendor module.
 *
 * Endpoint: `GET https://gen.pollinations.ai/image/<prompt>?model&width&height…`
 * — the whole request is the URL; the answer is the image bytes. Authenticated
 * with a SECRET key (`sk_…`, created at enter.pollinations.ai) as a Bearer token;
 * a publishable `pk_…` key is for browsers and must never be used here. Each
 * image spends "pollen" from the account balance; the catalog below keeps to the
 * cheapest models that are not `paid_only` (verified against
 * `GET https://gen.pollinations.ai/image/models`, 2026-10-04).
 *
 * Unbound without `POLLINATIONS_API_KEY`, like every other keyed vendor.
 *
 * We fetch the bytes server-side rather than handing back the Pollinations URL, because that URL renders lazily — a failure
 * would surface as a broken image in the customer's page instead of a cascade
 * step on to the next vendor.
 */

import {
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

const ENDPOINT_BASE = 'https://gen.pollinations.ai/image/';

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'black-forest-labs/flux.1-schnell', tier: 'FREE', label: 'Flux Schnell (Pollinations)',     brand: 'Black Forest Labs' },
  { id: 'tongyi-mai/z-image-turbo',          tier: 'FREE', label: 'Z-Image Turbo (Pollinations)',   brand: 'Tongyi-MAI' },
  { id: 'lykon/dreamshaper-8-lcm',           tier: 'FREE', label: 'DreamShaper 8 LCM (Pollinations)', brand: 'Lykon' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForPollinationsModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

/** The full request URL — prompt in the path, everything else as query params. */
export function pollinationsImageUrl(params: ImageGenParams): string {
  const dim = parseImageSize(params.size);
  const query = new URLSearchParams({
    model: params.model,
    nologo: 'true',
    // Keep generations out of the public Pollinations feed — they are a tenant's.
    private: 'true',
    ...(dim ? { width: String(dim.width), height: String(dim.height) } : {}),
  });
  for (const [key, value] of Object.entries(params.extraBody ?? {})) {
    if (value != null) query.set(key, String(value));
  }
  return `${ENDPOINT_BASE}${encodeURIComponent(params.prompt)}?${query.toString()}`;
}

export function parsePollinationsImageBody(
  model: string,
  body: ImageBody,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  if (body.kind === 'bytes') return imageResultFromBase64(model, body.base64, body.mimeType, responseFormat);
  throw noImageError('pollinations', model, 'returned JSON instead of image bytes');
}

export const pollinationsImageModule: ImageVendorModule = {
  id: 'pollinations',
  catalog: CATALOG,
  tierFor: tierForPollinationsModel,
  apiKeyFrom(env) { return env.POLLINATIONS_API_KEY ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'pollinations',
      endpoint: pollinationsImageUrl(params),
      apiKey: params.apiKey,
      model: params.model,
      body: {},
      method: 'GET',
      binary: true,
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parsePollinationsImageBody(params.model, raw as ImageBody, params.responseFormat),
    });
  },
};
