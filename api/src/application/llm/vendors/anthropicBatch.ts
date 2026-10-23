/**
 * Anthropic Message Batches adapter (PRD D6).
 *
 *   POST /v1/messages/batches          { requests: [{ custom_id, params }] }
 *   GET  /v1/messages/batches/{id}     processing_status: in_progress | canceling | ended
 *   GET  results_url                   JSONL: { custom_id, result: { type, message | error } }
 *
 * Each request's `params` is the body the synchronous vendor sends, built by the same
 * `prepareAnthropicRequest` — caching, schema dialect, output caps and thinking gating
 * cannot drift between the two paths — and each `message` comes back through the same
 * `toOpenAIResponse`, so usage is read exactly as a synchronous turn's is. Batches are
 * billed at 50% of the standard rate.
 *
 * Api keys only: a subscription (OAuth) token cannot drive the Batches API, which is why
 * `batchTarget.ts` never routes a subscription-funded call here.
 */
import { anthropicModule, prepareAnthropicRequest, toOpenAIResponse } from './anthropic';
import { fetchWithVendorTimeout, parseOpenAIResponse } from './types';
import type { BatchItemResult } from '../batch/batchTypes';
import {
  parseJsonLines,
  vendorParamsFor,
  type BatchPollState,
  type BatchSubmitItem,
  type BatchVendorAdapter,
} from '../batch/batchVendorPort';
import { reportCaughtError } from '../../observability/caughtErrorReporter';

export const ANTHROPIC_BATCHES_ENDPOINT = 'https://api.anthropic.com/v1/messages/batches';
/** Batch control calls are small; results can be large but are one GET. */
const CONTROL_TIMEOUT_MS = 30_000;
const RESULTS_TIMEOUT_MS = 60_000;

/** Result types the provider did not RUN — requeue rather than give up. */
const RETRYABLE_RESULT_TYPES: ReadonlySet<string> = new Set(['canceled', 'expired']);
/** Error types that are the request's own fault — retrying the same body cannot help. */
const FATAL_ERROR_TYPES: ReadonlySet<string> = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error']);

function headersFor(apiKey: string, model: string): Record<string, string> {
  return prepareAnthropicRequest({ apiKey, model, messages: [], maxTokens: 1 }, false).headers;
}

async function requireOk(resp: Response, what: string): Promise<Response> {
  if (resp.ok) return resp;
  const text = (await resp.text()).slice(0, 300);
  throw new Error(`anthropic batch ${what} HTTP ${resp.status}: ${text}`);
}

/** One JSONL result line → the job's outcome. Exported for tests. */
export function anthropicBatchLine(line: unknown): { customId: string; outcome: BatchItemResult } | null {
  const l = line as { custom_id?: unknown; result?: { type?: unknown; message?: unknown; error?: { error?: { type?: unknown; message?: unknown }; type?: unknown } } } | null;
  if (typeof l?.custom_id !== 'string') return null;
  const type = String(l.result?.type ?? '');
  if (type === 'succeeded') {
    const message = l.result?.message as { model?: unknown } | undefined;
    const oai = toOpenAIResponse(message, typeof message?.model === 'string' ? message.model : '');
    const parsed = parseOpenAIResponse(oai);
    return {
      customId: l.custom_id,
      outcome: { ok: true, result: { raw: oai, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) } },
    };
  }
  if (type === 'errored') {
    const inner = l.result?.error?.error ?? l.result?.error;
    const errType = String(inner?.type ?? 'api_error');
    return {
      customId: l.custom_id,
      outcome: { ok: false, error: `${errType}: ${String((inner as { message?: unknown } | undefined)?.message ?? '')}`.slice(0, 300), retryable: !FATAL_ERROR_TYPES.has(errType) },
    };
  }
  return { customId: l.custom_id, outcome: { ok: false, error: type || 'unknown result', retryable: RETRYABLE_RESULT_TYPES.has(type) || !type } };
}

export const anthropicBatchAdapter: BatchVendorAdapter = {
  vendor: 'anthropic',

  async submit(apiKey: string, items: readonly BatchSubmitItem[]): Promise<string> {
    const requests = items.map((item) => ({
      custom_id: item.customId,
      params: prepareAnthropicRequest(vendorParamsFor(apiKey, item.model, item.request), false).body,
    }));
    const model = items[0]?.model ?? '';
    const resp = await requireOk(await fetchWithVendorTimeout('anthropic', model, ANTHROPIC_BATCHES_ENDPOINT, {
      method: 'POST', headers: headersFor(apiKey, model), body: JSON.stringify({ requests }),
    }, CONTROL_TIMEOUT_MS), 'submit');
    const body = (await resp.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) throw new Error('anthropic batch submit returned no id');
    return body.id;
  },

  async poll(apiKey: string, providerBatchId: string): Promise<BatchPollState> {
    const resp = await requireOk(await fetchWithVendorTimeout('anthropic', 'batch', `${ANTHROPIC_BATCHES_ENDPOINT}/${encodeURIComponent(providerBatchId)}`, {
      method: 'GET', headers: headersFor(apiKey, 'batch'),
    }, CONTROL_TIMEOUT_MS), 'poll');
    const body = (await resp.json()) as { processing_status?: unknown; results_url?: unknown };
    if (body.processing_status !== 'ended') return { state: 'pending' };
    return { state: 'ended', resultsRef: typeof body.results_url === 'string' ? body.results_url : null };
  },

  async results(apiKey: string, providerBatchId: string, resultsRef: string | null): Promise<Map<string, BatchItemResult>> {
    const url = resultsRef ?? `${ANTHROPIC_BATCHES_ENDPOINT}/${encodeURIComponent(providerBatchId)}/results`;
    const resp = await requireOk(await fetchWithVendorTimeout('anthropic', 'batch', url, {
      method: 'GET', headers: headersFor(apiKey, 'batch'),
    }, RESULTS_TIMEOUT_MS), 'results');
    const out = new Map<string, BatchItemResult>();
    const lines = parseJsonLines(await resp.text(), (bad) => reportCaughtError(new Error('malformed batch result line'), {
      source: 'application/llm/vendors/anthropicBatch.ts', operation: 'results', level: 'warning', context: { providerBatchId, line: bad },
    }));
    for (const line of lines) {
      const parsed = anthropicBatchLine(line);
      if (parsed) out.set(parsed.customId, parsed.outcome);
    }
    return out;
  },

  callSync(apiKey, model, request) {
    return anthropicModule.call(vendorParamsFor(apiKey, model, request));
  },
};
