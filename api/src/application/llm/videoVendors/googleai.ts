/**
 * Google AI (Gemini API) Veo video vendor.
 *
 *   start → POST /v1beta/models/<model>:predictLongRunning   → { name: "<operation>" }
 *   poll  → GET  /v1beta/<operation>                          → { done, response | error }
 *   done  → GET  <generatedSamples[0].video.uri>              → video/mp4 bytes
 *
 * Every call authenticates with `x-goog-api-key` (Google rejects the key as a
 * Bearer token). Reuses the platform `GOOGLE_API_KEY`, which is billed, so Veo
 * sits only in the PREMIUM tier of the paid-plan pool.
 */

import {
  VendorRetryableError,
  classifyVideoFailure,
  fetchVideoBytes,
  type VideoModelEntry,
  type VideoStartParams,
  type VideoStepResult,
  type VideoVendorModule,
} from './types';
import { fetchWithVendorTimeout } from '../vendors/types';
import { bytesToBase64 } from '../../../domain/shared/bytes';
import type { MediaModelTier } from '../mediaVendorRegistry';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const CATALOG: ReadonlyArray<VideoModelEntry> = [
  { id: 'veo-3.1-fast-generate-preview', tier: 'PREMIUM', label: 'Veo 3.1 Fast (Google)', brand: 'Google', durations: [4, 6, 8] },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

/** How long to wait between operation polls. Veo clips take ~1–3 minutes. */
const POLL_INTERVAL_MS = 15_000;

/** Veo renders 16:9 and 9:16 only; a square request becomes landscape. */
function veoAspectRatio(aspect: VideoStartParams['aspectRatio']): '16:9' | '9:16' {
  return aspect === '9:16' ? '9:16' : '16:9';
}

/** Veo takes a first frame as inline base64, not a URL. */
async function inlineImage(params: VideoStartParams): Promise<{ bytesBase64Encoded: string; mimeType: string } | null> {
  if (!params.imageUrl) return null;
  const resp = await fetchWithVendorTimeout('googleai', params.model, params.imageUrl, { method: 'GET' }, 30_000);
  if (!resp.ok) throw new VendorRetryableError('googleai', params.model, 502, `first-frame image fetch failed (${resp.status})`);
  const mimeType = (resp.headers.get('Content-Type') ?? 'image/png').split(';')[0]!.trim();
  return { bytesBase64Encoded: bytesToBase64(await resp.arrayBuffer()), mimeType };
}

export function buildVeoBody(params: VideoStartParams, image: { bytesBase64Encoded: string; mimeType: string } | null): Record<string, unknown> {
  return {
    instances: [{ prompt: params.prompt, ...(image ? { image } : {}) }],
    parameters: {
      aspectRatio: veoAspectRatio(params.aspectRatio),
      durationSeconds: params.durationSeconds,
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
    },
  };
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }>; raiMediaFilteredReasons?: string[] } };
}

/** Read a finished (or still-running) operation into the next step. */
export function classifyVeoOperation(model: string, op: VeoOperation): { kind: 'pending' } | { kind: 'ready'; uri: string } {
  if (!op.done) return { kind: 'pending' };
  if (op.error) throw new VendorRetryableError('googleai', model, 502, `veo operation failed: ${op.error.message ?? op.error.code ?? 'unknown'}`);
  const response = op.response?.generateVideoResponse;
  const uri = response?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const filtered = response?.raiMediaFilteredReasons?.join('; ');
    throw new VendorRetryableError('googleai', model, 502, `embedded:empty: veo returned no video${filtered ? ` (filtered: ${filtered})` : ''}`);
  }
  return { kind: 'ready', uri };
}

async function readJson(model: string, resp: Response): Promise<VeoOperation> {
  if (!resp.ok) throw classifyVideoFailure('googleai', model, resp.status, (await resp.text()).slice(0, 300));
  return (await resp.json()) as VeoOperation;
}

export const googleVideoModule: VideoVendorModule = {
  id: 'googleai',
  catalog: CATALOG,
  tierFor: (modelId: string): MediaModelTier => CATALOG_BY_ID.get(modelId)?.tier ?? 'PREMIUM',
  apiKeyFrom(env) { return env.GOOGLE_API_KEY ?? null; },
  async start(params: VideoStartParams): Promise<VideoStepResult> {
    const body = buildVeoBody(params, await inlineImage(params));
    const resp = await fetchWithVendorTimeout('googleai', params.model, `${API_BASE}/models/${encodeURIComponent(params.model)}:predictLongRunning`, {
      method: 'POST',
      headers: { 'x-goog-api-key': params.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, params.timeoutMs ?? 60_000);
    const op = await readJson(params.model, resp);
    if (!op.name) throw new VendorRetryableError('googleai', params.model, 502, 'veo returned no operation name');
    return { kind: 'pending', handle: op.name, retryAfterMs: POLL_INTERVAL_MS };
  },
  async poll({ apiKey, model, handle, timeoutMs }): Promise<VideoStepResult> {
    const resp = await fetchWithVendorTimeout('googleai', model, `${API_BASE}/${handle}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    }, timeoutMs ?? 30_000);
    const state = classifyVeoOperation(model, await readJson(model, resp));
    if (state.kind === 'pending') return { kind: 'pending', handle, retryAfterMs: POLL_INTERVAL_MS };
    const { bytes, mimeType } = await fetchVideoBytes({
      vendorId: 'googleai', model, url: state.uri,
      init: { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
    });
    return { kind: 'done', bytes, mimeType };
  },
};
