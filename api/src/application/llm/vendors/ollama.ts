/**
 * Ollama Cloud vendor module — managed open-weight models behind a paid Ollama API key.
 *
 * Note: Ollama uses a non-OpenAI response shape (`raw.message.content`,
 * `raw.eval_count`, `raw.prompt_eval_count`) so it ships its own parser.
 *
 * Streaming is intentionally omitted: Ollama emits NDJSON, not SSE, and
 * adapting that to OpenAI SSE for downstream consumers is non-trivial. The
 * orchestrator will skip this vendor when a streaming request is dispatched.
 */

import {
  executeChatCompletion,
  type AiModelTier,
  type ResponseParser,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorUsage,
} from './types';

const ENDPOINT = 'https://ollama.com/api/chat';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'gpt-oss:120b',            tier: 'FREE', label: 'GPT-OSS 120B (Ollama Cloud)',         brand: 'Ollama' },
  { id: 'kimi-k2.6:cloud',         tier: 'FREE', label: 'Kimi K2.6 (Ollama Cloud)',            brand: 'Ollama' },
  { id: 'glm-5.1:cloud',           tier: 'FREE', label: 'GLM 5.1 (Ollama Cloud)',              brand: 'Ollama' },
  { id: 'deepseek-v4-flash:cloud', tier: 'FREE', label: 'DeepSeek V4 Flash (Ollama Cloud)',    brand: 'Ollama' },
  { id: 'gemma4',                  tier: 'FREE', label: 'Gemma 4 (Ollama)',                    brand: 'Ollama' },
  { id: 'qwen3.5',                 tier: 'FREE', label: 'Qwen 3.5 (Ollama)',                   brand: 'Ollama' },
  { id: 'qwen3-coder-next',        tier: 'FREE', label: 'Qwen 3 Coder (Ollama · code)',        brand: 'Ollama' },
  { id: 'ministral-3',             tier: 'FREE', label: 'Ministral 3 (Ollama · small/fast)',   brand: 'Ollama' },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForOllamaModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

const parseOllamaResponse: ResponseParser = (raw) => {
  const r = raw as { message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown };
  const content = String(r?.message?.content ?? '');
  const promptTokens     = num(r?.prompt_eval_count);
  const completionTokens = num(r?.eval_count);
  const usage: VendorUsage = {};
  if (promptTokens     !== undefined) usage.prompt_tokens     = promptTokens;
  if (completionTokens !== undefined) usage.completion_tokens = completionTokens;
  if (promptTokens !== undefined && completionTokens !== undefined) {
    usage.total_tokens = promptTokens + completionTokens;
  }
  return { content, ...(Object.keys(usage).length > 0 ? { usage } : {}) };
};

function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const ollamaModule: VendorModule = {
  id: 'ollama',
  catalog: CATALOG,
  tierFor: tierForOllamaModel,
  fallbackModel: 'gemma4',
  apiKeyFrom(env) { return env.OLLAMA_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const { model, messages, tools, maxTokens, temperature, topP, extraBody } = params;
    const options: Record<string, unknown> = {};
    if (maxTokens   != null) options['num_predict'] = maxTokens;
    if (temperature != null) options['temperature'] = temperature;
    if (topP        != null) options['top_p']       = topP;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      ...(tools ? { tools } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(extraBody ?? {}),
    };

    return executeChatCompletion({
      vendorId: 'ollama',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body,
      parseResponse: parseOllamaResponse,
      ...(params.title ? { title: params.title } : {}),
    });
  },
  // No callStream — Ollama emits NDJSON not SSE; orchestrator will skip during streaming dispatch.
};
