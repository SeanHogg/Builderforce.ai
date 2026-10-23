/**
 * The port a provider batch API is driven through. One adapter per provider
 * (`vendors/anthropicBatch.ts`, `vendors/openaiBatch.ts`); the tick never knows which.
 *
 * Every method takes the resolved api key — credentials are resolved per call at the
 * tick (`batchCredentials.ts`), never stored on a job.
 */
import type { VendorCallParams, VendorCallResult } from '../vendors/types';
import type { BatchItemResult, BatchVendor, DeferredLlmRequest } from './batchTypes';

/** One request inside a provider batch. */
export interface BatchSubmitItem {
  customId: string;
  model: string;
  request: DeferredLlmRequest;
}

/** Where a submitted provider batch is. `ended` carries what `results` needs to fetch. */
export type BatchPollState =
  | { state: 'pending' }
  | { state: 'ended'; resultsRef: string | null }
  /** The whole batch failed or was cancelled before running anything usable. */
  | { state: 'failed'; reason: string };

export interface BatchVendorAdapter {
  vendor: BatchVendor;
  /** Create one provider batch; returns the provider's batch id. Throws on refusal. */
  submit(apiKey: string, items: readonly BatchSubmitItem[]): Promise<string>;
  poll(apiKey: string, providerBatchId: string): Promise<BatchPollState>;
  /** The per-request outcomes of an ended batch, keyed by `customId`. A request absent
   *  from the map produced no line at all (treat as retryable). */
  results(apiKey: string, providerBatchId: string, resultsRef: string | null): Promise<Map<string, BatchItemResult>>;
  /** The SAME request, synchronously — the fallback when a job outlives its SLA or the
   *  batch path gave up on it. Delegates to the provider's synchronous vendor module. */
  callSync(apiKey: string, model: string, request: DeferredLlmRequest): Promise<VendorCallResult>;
}

/** The synchronous vendors' call params for a deferred request — one mapping, so the
 *  batch body and the fallback call are built from identical inputs. */
export function vendorParamsFor(apiKey: string, model: string, request: DeferredLlmRequest): VendorCallParams {
  return {
    apiKey,
    model,
    messages: request.messages,
    maxTokens: request.maxTokens,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    ...(request.responseFormat ? { extraBody: { response_format: request.responseFormat } } : {}),
  };
}

/** Split a JSONL body into parsed lines, logging (not throwing on) a malformed one. */
export function parseJsonLines(body: string, onBadLine: (line: string) => void): unknown[] {
  const out: unknown[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      onBadLine(trimmed.slice(0, 200));
    }
  }
  return out;
}
