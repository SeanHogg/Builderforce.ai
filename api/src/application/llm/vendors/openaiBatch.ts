/**
 * OpenAI Batch API adapter (PRD D6).
 *
 *   POST /v1/files                multipart, purpose=batch, a JSONL of
 *                                 { custom_id, method: POST, url: /v1/chat/completions, body }
 *   POST /v1/batches              { input_file_id, endpoint, completion_window: '24h' }
 *   GET  /v1/batches/{id}         status: validating | in_progress | finalizing | completed |
 *                                 expired | failed | cancelling | cancelled
 *   GET  /v1/files/{id}/content   output (and error) JSONL: { custom_id, response: { status_code, body } }
 *
 * Each line's `body` is built by `buildOpenAIChatBody` — the builder the synchronous
 * OpenAI vendor sends — and each response body is read by the same
 * `parseOpenAIResponse`. Billed at 50% of the standard rate. An `expired` batch still
 * returns what it finished; the rest come back absent and are requeued by the tick.
 */
import { openAICompatibleModulesById } from './openaiCompatibleVendors';
import { buildOpenAIChatBody, fetchWithVendorTimeout, parseOpenAIResponse } from './types';
import type { BatchItemResult } from '../batch/batchTypes';
import {
  parseJsonLines,
  vendorParamsFor,
  type BatchPollState,
  type BatchSubmitItem,
  type BatchVendorAdapter,
} from '../batch/batchVendorPort';
import { reportCaughtError } from '../../observability/caughtErrorReporter';

/** The API root of the host the `openai` vendor module calls. */
export const OPENAI_API_BASE = 'https://api.openai.com/v1';
const CHAT_PATH = '/v1/chat/completions';
const CONTROL_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 60_000;

/** Statuses after which the batch produces nothing more. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(['completed', 'expired']);
const FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled']);

function auth(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

async function requireOk(resp: Response, what: string): Promise<Response> {
  if (resp.ok) return resp;
  const text = (await resp.text()).slice(0, 300);
  throw new Error(`openai batch ${what} HTTP ${resp.status}: ${text}`);
}

/** One output/error JSONL line → the job's outcome. Exported for tests. */
export function openaiBatchLine(line: unknown): { customId: string; outcome: BatchItemResult } | null {
  const l = line as { custom_id?: unknown; response?: { status_code?: unknown; body?: unknown } | null; error?: { code?: unknown; message?: unknown } | null } | null;
  if (typeof l?.custom_id !== 'string') return null;
  const status = Number(l.response?.status_code ?? 0);
  if (status >= 200 && status < 300 && l.response?.body) {
    const parsed = parseOpenAIResponse(l.response.body);
    return {
      customId: l.custom_id,
      outcome: { ok: true, result: { raw: l.response.body, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) } },
    };
  }
  const bodyError = (l.response?.body as { error?: { message?: unknown } } | undefined)?.error;
  const message = String(bodyError?.message ?? l.error?.message ?? l.error?.code ?? `status ${status}`);
  // No status (a line-level error), a rate limit or a server error are the provider's,
  // not the request's — requeue them.
  const retryable = status === 0 || status === 429 || status >= 500;
  return { customId: l.custom_id, outcome: { ok: false, error: message.slice(0, 300), retryable } };
}

async function readFileLines(apiKey: string, fileId: string, providerBatchId: string): Promise<unknown[]> {
  const resp = await requireOk(await fetchWithVendorTimeout('openai', 'batch', `${OPENAI_API_BASE}/files/${encodeURIComponent(fileId)}/content`, {
    method: 'GET', headers: auth(apiKey),
  }, FILE_TIMEOUT_MS), 'file content');
  return parseJsonLines(await resp.text(), (bad) => reportCaughtError(new Error('malformed batch result line'), {
    source: 'application/llm/vendors/openaiBatch.ts', operation: 'results', level: 'warning', context: { providerBatchId, line: bad },
  }));
}

async function readBatch(apiKey: string, providerBatchId: string): Promise<{ status?: unknown; output_file_id?: unknown; error_file_id?: unknown; errors?: unknown }> {
  const resp = await requireOk(await fetchWithVendorTimeout('openai', 'batch', `${OPENAI_API_BASE}/batches/${encodeURIComponent(providerBatchId)}`, {
    method: 'GET', headers: auth(apiKey),
  }, CONTROL_TIMEOUT_MS), 'poll');
  return resp.json();
}

export const openaiBatchAdapter: BatchVendorAdapter = {
  vendor: 'openai',

  async submit(apiKey: string, items: readonly BatchSubmitItem[]): Promise<string> {
    const jsonl = items
      .map((item) => JSON.stringify({
        custom_id: item.customId,
        method: 'POST',
        url: CHAT_PATH,
        body: { ...buildOpenAIChatBody(vendorParamsFor(apiKey, item.model, item.request)), stream: false },
      }))
      .join('\n');
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');
    const model = items[0]?.model ?? 'batch';
    const upload = await requireOk(await fetchWithVendorTimeout('openai', model, `${OPENAI_API_BASE}/files`, {
      method: 'POST', headers: auth(apiKey), body: form,
    }, FILE_TIMEOUT_MS), 'file upload');
    const file = (await upload.json()) as { id?: unknown };
    if (typeof file.id !== 'string' || !file.id) throw new Error('openai batch file upload returned no id');
    const created = await requireOk(await fetchWithVendorTimeout('openai', model, `${OPENAI_API_BASE}/batches`, {
      method: 'POST',
      headers: { ...auth(apiKey), 'content-type': 'application/json' },
      body: JSON.stringify({ input_file_id: file.id, endpoint: CHAT_PATH, completion_window: '24h' }),
    }, CONTROL_TIMEOUT_MS), 'create');
    const batch = (await created.json()) as { id?: unknown };
    if (typeof batch.id !== 'string' || !batch.id) throw new Error('openai batch create returned no id');
    return batch.id;
  },

  async poll(apiKey: string, providerBatchId: string): Promise<BatchPollState> {
    const batch = await readBatch(apiKey, providerBatchId);
    const status = String(batch.status ?? '');
    if (ENDED_STATUSES.has(status)) return { state: 'ended', resultsRef: null };
    if (FAILED_STATUSES.has(status)) return { state: 'failed', reason: `openai batch ${status}` };
    return { state: 'pending' };
  },

  async results(apiKey: string, providerBatchId: string): Promise<Map<string, BatchItemResult>> {
    // Re-read the batch for BOTH file ids: successes and refusals land in different files.
    const batch = await readBatch(apiKey, providerBatchId);
    const out = new Map<string, BatchItemResult>();
    for (const fileId of [batch.output_file_id, batch.error_file_id]) {
      if (typeof fileId !== 'string' || !fileId) continue;
      for (const line of await readFileLines(apiKey, fileId, providerBatchId)) {
        const parsed = openaiBatchLine(line);
        if (parsed) out.set(parsed.customId, parsed.outcome);
      }
    }
    return out;
  },

  callSync(apiKey, model, request) {
    const openai = openAICompatibleModulesById['openai'];
    if (!openai) throw new Error('openai vendor module is not registered');
    return openai.call(vendorParamsFor(apiKey, model, request));
  },
};
