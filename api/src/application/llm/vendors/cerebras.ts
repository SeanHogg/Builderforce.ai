/**
 * Cerebras vendor module — sub-200ms TTFT inference for latency-critical use cases
 * (classification, simple routing, fast first-token chat).
 *
 * Quotas (2026-05): llama3.1-8b — 30 req/min, 60K tok/min, 14.4K req/day, 1M tok/day.
 *                  qwen-3-235b — 1 req/min, 30K tok/min, 14.4K req/day, 1M tok/day.
 */

import {
  executeChatCompletion,
  executeChatCompletionStream,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

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
  const { model, messages, tools, toolChoice, maxTokens, temperature, topP, extraBody } = params;
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    // Cerebras prefers `max_completion_tokens` (newer field name).
    ...(maxTokens != null ? { max_completion_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...(extraBody ?? {}),
  };
}

export const cerebrasModule: VendorModule = {
  id: 'cerebras',
  catalog: CATALOG,
  tierFor: tierForCerebrasModel,
  fallbackModel: 'llama3.1-8b',
  apiKeyFrom(env) { return env.CEREBRAS_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'cerebras',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: { ...buildBody(params), stream: false },
      ...(params.title ? { title: params.title } : {}),
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
    });
  },
};
