/**
 * Cerebras vendor module — sub-200ms TTFT inference for latency-critical use cases
 * (classification, simple routing, fast first-token chat).
 *
 * Quotas (2026-05): llama3.1-8b — 30 req/min, 60K tok/min, 14.4K req/day, 1M tok/day.
 *                  qwen-3-235b — 1 req/min, 30K tok/min, 14.4K req/day, 1M tok/day.
 */

import {
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';
import { sanitizeExtraBodyForVendor } from '../jsonSchemaSanitize';

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'llama3.1-8b',                      tier: 'FREE', label: 'Llama 3.1 8B (Cerebras · Fast)',   brand: 'Cerebras' },
  { id: 'qwen-3-235b-a22b-instruct-2507',   tier: 'FREE', label: 'Qwen 3 235B (Cerebras · Preview)', brand: 'Cerebras' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForCerebrasModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  // Cerebras prefers `max_completion_tokens`, and its strict JSON-Schema validator
  // rejects draft-07 keywords (`maxLength`/`format`/`pattern`/…) that Zod's
  // `toJSONSchema()` emits — strip them from the passthrough. See jsonSchemaSanitize.ts.
  return buildOpenAIChatBody(params, {
    maxTokensField: 'max_completion_tokens',
    transformExtra: (extra) => sanitizeExtraBodyForVendor('cerebras', extra),
  });
}

export const cerebrasModule: VendorModule = {
  id: 'cerebras',
  catalog: CATALOG,
  tierFor: tierForCerebrasModel,
  apiKeyFrom(env) { return env.CEREBRAS_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'cerebras',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: { ...buildBody(params), stream: false },
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream({
      vendorId: 'cerebras',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  },
};
