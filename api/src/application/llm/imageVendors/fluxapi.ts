/**
 * FluxAPI (fluxapi.ai) image-generation vendor module — premium fallback
 * for the image-gen cascade. Called after the free Together attempts are
 * exhausted so callers always see a successful image response.
 *
 * Endpoint:
 *   POST https://api.fluxapi.ai/api/v1/flux/kontext/generate
 *   Authorization: Bearer <FLUX_API_KEY>
 *
 * Response shape (non-OpenAI):
 *   { code, data: { taskId, ... }, message }  — async/poll
 *   { code, data: { url, ... }, message }     — sync
 * We normalise either shape into the OpenAI-compatible `{ data: [{ url }] }`
 * surface so the SDK doesn't have to know which vendor resolved.
 *
 * Authenticates with `FLUX_API_KEY`.
 */

import {
  VendorRetryableError,
  executeImageGeneration,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

const ENDPOINT = 'https://api.fluxapi.ai/api/v1/flux/kontext/generate';

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'flux-kontext-pro', tier: 'PREMIUM', label: 'Flux Kontext Pro (FluxAPI)', brand: 'Black Forest Labs' },
  { id: 'flux-kontext-max', tier: 'PREMIUM', label: 'Flux Kontext Max (FluxAPI)', brand: 'Black Forest Labs' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForFluxApiModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'PREMIUM';
}

/**
 * Convert an OpenAI-style "WxH" size into FluxAPI's `aspectRatio` ratio string.
 * FluxAPI accepts "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21".
 *
 * Maps "1024x1024" → "1:1", "1792x1024" → "16:9" (approx). Unknown ratios
 * fall back to "1:1" so the request still succeeds.
 */
export function sizeToAspectRatio(size?: string): string {
  if (!size) return '1:1';
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return '1:1';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w === 0 || h === 0) return '1:1';
  const r = w / h;
  if (r >= 2.2)  return '21:9';
  if (r >= 1.6)  return '16:9';
  if (r >= 1.25) return '4:3';
  if (r >= 0.85) return '1:1';
  if (r >= 0.65) return '3:4';
  if (r >= 0.45) return '9:16';
  return '9:21';
}

function buildBody(params: ImageGenParams): Record<string, unknown> {
  return {
    model: params.model,
    prompt: params.prompt,
    aspectRatio: sizeToAspectRatio(params.size),
    outputFormat: 'jpeg',
    enableTranslation: true,
    promptUpsampling: false,
    safetyTolerance: 2,
    ...(params.extraBody ?? {}),
  };
}

/**
 * Extract a hosted image URL from FluxAPI's response shape. FluxAPI returns
 * different envelopes for sync vs async tasks; we accept either as long as
 * a URL is present, otherwise throw a retryable error so the cascade falls
 * through to the next fallback.
 *
 * Tried URL shapes, first hit wins:
 *   data.url, data.imageUrl, data.image, data.result.url, data.output_url
 */
export function extractFluxImageUrl(raw: unknown): string | null {
  const r = raw as Record<string, unknown> | null;
  const data = r?.['data'] as Record<string, unknown> | undefined;
  if (!data) return null;
  const candidates: Array<unknown> = [
    data['url'],
    data['imageUrl'],
    data['image'],
    (data['result'] as Record<string, unknown> | undefined)?.['url'],
    data['output_url'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

function parseFluxResponse(model: string, raw: unknown): ImageGenResult {
  const url = extractFluxImageUrl(raw);
  if (!url) {
    // 200 OK but no URL we recognise — async-poll variant likely. For MVP
    // we treat this as retryable so the cascade advances; the polling loop
    // is logged as a deferred gap in the README.
    const r = raw as Record<string, unknown> | null;
    const code = r?.['code'];
    const msg  = typeof r?.['message'] === 'string' ? r['message'] as string : 'no image url in response';
    throw new VendorRetryableError('fluxapi', model, 502, `embedded: code=${String(code)}: ${msg}`);
  }
  return {
    created: Math.floor(Date.now() / 1000),
    model,
    data: [{ url }],
  };
}

export const fluxApiModule: ImageVendorModule = {
  id: 'fluxapi',
  catalog: CATALOG,
  tierFor: tierForFluxApiModel,
  apiKeyFrom(env) { return env.FLUX_API_KEY ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'fluxapi',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseFluxResponse(params.model, raw),
    });
  },
};
