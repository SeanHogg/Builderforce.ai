/**
 * Pollinations image-generation vendor module.
 *
 * Endpoint: `GET https://image.pollinations.ai/prompt/<prompt>?width&height&model…`
 * — the whole request is the URL; the answer is the image bytes. Free, with a
 * token (`POLLINATIONS_API_KEY`, issued free at auth.pollinations.ai) lifting the
 * anonymous rate limit and the watermark.
 *
 * OPT-IN on purpose: the anonymous tier has no SLA, so the vendor is bound only
 * when an operator sets the token. We fetch the bytes server-side rather than
 * handing back the Pollinations URL, because that URL renders lazily — a failure
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

const ENDPOINT_BASE = 'https://image.pollinations.ai/prompt/';

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'flux',  tier: 'FREE', label: 'Flux (Pollinations)',  brand: 'Black Forest Labs' },
  { id: 'turbo', tier: 'FREE', label: 'Turbo (Pollinations)', brand: 'Pollinations' },
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
