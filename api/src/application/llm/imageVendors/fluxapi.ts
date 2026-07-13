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
 *   { code, data: { taskId, ... }, message }  — async/poll (long-running prompts)
 *   { code, data: { url, ... }, message }     — sync
 *
 * We normalise either shape into the OpenAI-compatible `{ data: [{ url }] }`
 * surface so the SDK doesn't have to know which vendor resolved. For the async
 * variant we poll `GET /api/v1/flux/kontext/task/<id>` with backoff until the
 * image is ready or the per-vendor timeout fires (previously the async shape was
 * thrown away as a retryable 502, so long-running Flux Kontext prompts ALWAYS
 * failed over to a cheaper model instead of completing).
 *
 * Authenticates with `FLUX_API_KEY`.
 */

import {
  VendorRetryableError,
  executeImageGeneration,
  fetchWithVendorTimeout,
  imageVendorTimeoutMs,
  type ImageGenParams,
  type ImageGenResult,
  type ImageModelTier,
  type ImageVendorModelEntry,
  type ImageVendorModule,
} from './types';

const ENDPOINT = 'https://api.fluxapi.ai/api/v1/flux/kontext/generate';
const TASK_ENDPOINT_BASE = 'https://api.fluxapi.ai/api/v1/flux/kontext/task';

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
 * a URL is present.
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

/**
 * Extract the async task id from FluxAPI's initial response when no image URL
 * is present yet. Shapes observed / accepted: `data.taskId`, `data.task_id`,
 * `data.id`. Returns `null` for the sync shape (URL already present) or an
 * envelope with neither.
 */
export function extractFluxTaskId(raw: unknown): string | null {
  const r = raw as Record<string, unknown> | null;
  const data = r?.['data'] as Record<string, unknown> | undefined;
  if (!data) return null;
  for (const key of ['taskId', 'task_id', 'id'] as const) {
    const v = data[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** A task is "done" once its envelope carries a URL. Also classify an explicit
 *  failure status so we stop polling early instead of waiting out the budget. */
type TaskState = { kind: 'ready'; url: string } | { kind: 'pending' } | { kind: 'failed'; message: string };

export function classifyFluxTaskResponse(raw: unknown): TaskState {
  const url = extractFluxImageUrl(raw);
  if (url) return { kind: 'ready', url };
  const r = raw as Record<string, unknown> | null;
  const data = r?.['data'] as Record<string, unknown> | undefined;
  const status = String(data?.['status'] ?? r?.['status'] ?? '').toLowerCase();
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
    const msg = typeof r?.['message'] === 'string' ? (r['message'] as string) : `task ${status}`;
    return { kind: 'failed', message: msg };
  }
  return { kind: 'pending' };
}

/**
 * Poll a FluxAPI async task to completion. Pure/DI: the `fetchJson` and `sleep`
 * are injected so the loop is unit-testable without a live API or real timers.
 * Backoff caps at `maxPollMs` of cumulative wait; on exhaustion throws a
 * retryable 504 so the cascade fails over (same as before, but only AFTER
 * genuinely waiting rather than on the first async envelope).
 */
export async function pollFluxTask(args: {
  model: string;
  taskId: string;
  fetchJson: (taskId: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
  maxPollMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}): Promise<ImageGenResult> {
  const { model, taskId, fetchJson, sleep, nowMs } = args;
  const maxPollMs = args.maxPollMs ?? 40_000;
  const maxDelayMs = args.maxDelayMs ?? 4_000;
  let delay = args.initialDelayMs ?? 1_000;
  const start = nowMs();

  for (;;) {
    if (nowMs() - start >= maxPollMs) {
      throw new VendorRetryableError('fluxapi', model, 504, `async task ${taskId} not ready after ${maxPollMs}ms`);
    }
    await sleep(delay);
    let raw: unknown;
    try {
      raw = await fetchJson(taskId);
    } catch (err) {
      // A transient poll error is retryable at the cascade level.
      const msg = err instanceof Error ? err.message : String(err);
      throw new VendorRetryableError('fluxapi', model, 502, `task poll failed: ${msg}`);
    }
    const state = classifyFluxTaskResponse(raw);
    if (state.kind === 'ready') {
      return { created: Math.floor(Date.now() / 1000), model, data: [{ url: state.url }] };
    }
    if (state.kind === 'failed') {
      throw new VendorRetryableError('fluxapi', model, 502, `task ${taskId} failed: ${state.message}`);
    }
    delay = Math.min(delay * 2, maxDelayMs);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Live task-status fetcher built on the shared per-call timeout transport. */
async function fetchFluxTask(apiKey: string, model: string, taskId: string, timeoutMs: number): Promise<unknown> {
  const resp = await fetchWithVendorTimeout(
    'fluxapi',
    model,
    `${TASK_ENDPOINT_BASE}/${encodeURIComponent(taskId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
    timeoutMs,
  );
  if (!resp.ok) {
    throw new VendorRetryableError('fluxapi', model, resp.status, `task status ${resp.status}`);
  }
  return resp.json();
}

export const fluxApiModule: ImageVendorModule = {
  id: 'fluxapi',
  catalog: CATALOG,
  tierFor: tierForFluxApiModel,
  apiKeyFrom(env) { return env.FLUX_API_KEY ?? null; },
  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    // Initial POST. We capture the RAW envelope (parseResponse passthrough) so we
    // can branch on sync-URL vs async-taskId rather than throwing the async case.
    let initialRaw: unknown;
    const result = await executeImageGeneration({
      vendorId: 'fluxapi',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => {
        initialRaw = raw;
        const url = extractFluxImageUrl(raw);
        if (url) return { created: Math.floor(Date.now() / 1000), model: params.model, data: [{ url }] };
        // No sync URL — return a placeholder; generate() inspects `initialRaw`
        // for a taskId and polls. Empty `data` signals "not resolved yet".
        return { created: Math.floor(Date.now() / 1000), model: params.model, data: [] };
      },
    });

    if (result.data.length > 0) return result; // sync path resolved

    const taskId = extractFluxTaskId(initialRaw);
    if (!taskId) {
      // 200 OK, no URL and no task id — genuinely unusable. Retryable so the
      // cascade advances (unchanged from the pre-poll behaviour for this case).
      const r = initialRaw as Record<string, unknown> | null;
      const code = r?.['code'];
      const msg = typeof r?.['message'] === 'string' ? (r['message'] as string) : 'no image url or task id in response';
      throw new VendorRetryableError('fluxapi', params.model, 502, `embedded: code=${String(code)}: ${msg}`);
    }

    const pollTimeoutMs = imageVendorTimeoutMs(params.timeoutMs);
    return pollFluxTask({
      model: params.model,
      taskId,
      fetchJson: (id) => fetchFluxTask(params.apiKey, params.model, id, pollTimeoutMs),
      sleep,
      nowMs: () => Date.now(),
      maxPollMs: pollTimeoutMs,
    });
  },
};
