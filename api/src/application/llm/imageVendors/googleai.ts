/**
 * Google AI (Gemini) image-generation vendor module — Gemini's native image
 * models ("Nano Banana") via the Generative Language API.
 *
 * Endpoint: `POST /v1beta/models/<model>:generateContent`, authenticated with the
 * `x-goog-api-key` header (Google rejects the key as a Bearer token). The request
 * asks for IMAGE output only; the image comes back inline as base64 on a
 * `candidates[].content.parts[].inlineData` part.
 *
 * Reuses `GOOGLE_API_KEY` — the platform's Gemini key the chat cascade already
 * holds. That key is billed, so both models are paid tiers (Pro pool), never the
 * FREE slice: the AI Studio free quota for image output is too small and too
 * volatile to promise to free-plan tenants.
 */

import {
  executeImageGeneration,
  imageResultFromBase64,
  noImageError,
  sizeToAspectRatio,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

const CATALOG: ReadonlyArray<ImageVendorModelEntry> = [
  { id: 'gemini-2.5-flash-image',     tier: 'STANDARD', label: 'Gemini 2.5 Flash Image (Google)', brand: 'Google' },
  { id: 'gemini-3-pro-image-preview', tier: 'PREMIUM',  label: 'Gemini 3 Pro Image (Google)',     brand: 'Google' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForGoogleImageModel(modelId: string): ImageModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'STANDARD';
}

/** Gemini accepts the shared ladder except the tall 9:21 — clamp it to 9:16. */
function geminiAspectRatio(size?: string): string {
  const ratio = sizeToAspectRatio(size);
  return ratio === '9:21' ? '9:16' : ratio;
}

export function buildGoogleImageBody(params: ImageGenParams): Record<string, unknown> {
  return {
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: geminiAspectRatio(params.size) },
    },
    ...(params.extraBody ?? {}),
  };
}

interface GeminiPart { inlineData?: { mimeType?: string; data?: string }; text?: string }

export function parseGoogleImageResponse(
  model: string,
  raw: unknown,
  responseFormat: ImageGenParams['responseFormat'],
): ImageGenResult {
  const candidates = (raw as { candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }> } | null)?.candidates ?? [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) return imageResultFromBase64(model, data, part.inlineData?.mimeType ?? 'image/png', responseFormat);
    }
  }
  // A safety block answers 200 with a finishReason and no image part.
  const reason = candidates[0]?.finishReason;
  throw noImageError('googleai', model, reason ? `returned no image (finishReason=${reason})` : undefined);
}

export const googleImageModule: ImageVendorModule = {
  id: 'googleai',
  catalog: CATALOG,
  tierFor: tierForGoogleImageModel,
  apiKeyFrom(env) { return env.GOOGLE_API_KEY ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    return executeImageGeneration({
      vendorId: 'googleai',
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
      apiKey: params.apiKey,
      model: params.model,
      body: buildGoogleImageBody(params),
      authorization: null,
      headers: { 'x-goog-api-key': params.apiKey },
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseGoogleImageResponse(params.model, raw, params.responseFormat),
    });
  },
};
