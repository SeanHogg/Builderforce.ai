/**
 * Hugging Face Inference Providers image-generation vendor module.
 *
 * Endpoint: `POST https://router.huggingface.co/hf-inference/models/<model>` with
 * `{ inputs, parameters }`; the answer is the raw image bytes. Authenticates with
 * an `hf_*` token (`HF_API_TOKEN`). The monthly free credit an HF account carries
 * covers light use, so the models sit in the FREE slice — a credit-exhausted
 * account answers 402, which the cascade treats as "try the next vendor".
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

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'black-forest-labs/FLUX.1-schnell',         tier: 'FREE', label: 'Flux Schnell (Hugging Face)', brand: 'Black Forest Labs' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', tier: 'FREE', label: 'SDXL Base (Hugging Face)',    brand: 'Stability AI' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForHuggingFaceModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

export function buildHuggingFaceImageBody(params: ImageGenParams): Record<string, unknown> {
  const dim = parseImageSize(params.size);
  return {
    inputs: params.prompt,
    parameters: {
      ...(dim ? { width: dim.width, height: dim.height } : {}),
      ...(params.extraBody ?? {}),
    },
  };
}

export function parseHuggingFaceImageBody(
  model: string,
  body: ImageBody,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  if (body.kind === 'bytes') return imageResultFromBase64(model, body.base64, body.mimeType, responseFormat);
  // A JSON 200 here is a queued/loading notice, never an image.
  throw noImageError('huggingface', model, 'returned JSON instead of image bytes');
}

export const huggingFaceImageModule: ImageVendorModule = {
  id: 'huggingface',
  catalog: CATALOG,
  tierFor: tierForHuggingFaceModel,
  apiKeyFrom(env) { return env.HF_API_TOKEN ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'huggingface',
      endpoint: `https://router.huggingface.co/hf-inference/models/${params.model}`,
      apiKey: params.apiKey,
      model: params.model,
      body: buildHuggingFaceImageBody(params),
      headers: { Accept: 'image/png' },
      binary: true,
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseHuggingFaceImageBody(params.model, raw as ImageBody, params.responseFormat),
    });
  },
};
