/**
 * OpenRouter embeddings vendor module — primary embeddings provider via the
 * OpenAI-compatible `/embeddings` endpoint. Drives the first attempts in the
 * embeddings cascade; falls through to Voyage only when OpenRouter fails.
 *
 * Authenticates with the per-plan OpenRouter key (the route picks Free vs Pro
 * before building the vendor env).
 */

import {
  executeEmbeddings,
  parseOpenAIEmbeddings,
  type EmbeddingGenParams,
  type EmbeddingGenResult,
  type EmbeddingVendorModelEntry,
  type EmbeddingVendorModule,
} from './types';

const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

/**
 * Default embedding model. NVIDIA's free Nemotron embed model is competitive
 * with OpenAI's small for English-only use cases, and is the model BurnRateOS
 * already calibrated against. Caller can override per-call via `body.model`.
 */
export const DEFAULT_EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';

const CATALOG: ReadonlyArray<EmbeddingVendorModelEntry> = [
  { id: DEFAULT_EMBEDDING_MODEL,           label: 'Nemotron Embed VL 1B (Free)', brand: 'NVIDIA' },
  { id: 'openai/text-embedding-3-small',   label: 'Text Embedding 3 Small',      brand: 'OpenAI' },
  { id: 'openai/text-embedding-3-large',   label: 'Text Embedding 3 Large',      brand: 'OpenAI' },
];

const HEADERS = { 'HTTP-Referer': 'https://builderforce.ai' };

function buildBody(params: EmbeddingGenParams): Record<string, unknown> {
  return {
    model: params.model,
    input: params.input,
    ...(params.extraBody ?? {}),
  };
}

export const openRouterEmbeddingModule: EmbeddingVendorModule = {
  id: 'openrouter',
  catalog: CATALOG,
  defaultModel: DEFAULT_EMBEDDING_MODEL,
  apiKeyFrom(env) { return env.OPENROUTER_API_KEY ?? null; },
  async embed(params: EmbeddingGenParams): Promise<EmbeddingGenResult> {
    return executeEmbeddings({
      vendorId: 'openrouter',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      headers: HEADERS,
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseOpenAIEmbeddings('openrouter', params.model, raw),
    });
  },
};
