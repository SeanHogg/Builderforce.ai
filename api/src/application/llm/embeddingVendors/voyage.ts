/**
 * Voyage AI embeddings vendor module — failover provider via the
 * OpenAI-compatible `/v1/embeddings` endpoint at api.voyageai.com. After the
 * primary OpenRouter attempts fail (endpoint outage, model removed, rate
 * limit), the embeddings cascade falls through here so vector workflows keep
 * working during a single-vendor outage.
 *
 * Authenticates with `VOYAGE_API_KEY`. Voyage's response envelope is OpenAI
 * shaped (`{ data: [{ embedding, index }], usage }`), so the shared parser
 * applies unchanged. Voyage uses its own model namespace (`voyage-3-lite`,
 * `voyage-3`, …) — when the candidate chain reaches Voyage with an OpenRouter
 * model id pinned, the registry substitutes `defaultModel`.
 */

import {
  executeEmbeddings,
  parseOpenAIEmbeddings,
  type EmbeddingGenParams,
  type EmbeddingGenResult,
  type EmbeddingVendorModelEntry,
  type EmbeddingVendorModule,
} from './types';

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/**
 * Default Voyage model. `voyage-3-lite` is the cost-optimised general-purpose
 * embedder — a sensible failover for the free Nemotron primary. Caller can
 * override per-call via a `voyage/`-prefixed model id (see registry).
 */
export const DEFAULT_VOYAGE_EMBEDDING_MODEL = 'voyage-3-lite';

const CATALOG: ReadonlyArray<EmbeddingVendorModelEntry> = [
  { id: 'voyage-3-lite', label: 'Voyage 3 Lite',  brand: 'Voyage AI' },
  { id: 'voyage-3',      label: 'Voyage 3',       brand: 'Voyage AI' },
  { id: 'voyage-code-3', label: 'Voyage Code 3',  brand: 'Voyage AI' },
];

function buildBody(params: EmbeddingGenParams): Record<string, unknown> {
  return {
    model: params.model,
    input: params.input,
    ...(params.extraBody ?? {}),
  };
}

export const voyageEmbeddingModule: EmbeddingVendorModule = {
  id: 'voyage',
  catalog: CATALOG,
  defaultModel: DEFAULT_VOYAGE_EMBEDDING_MODEL,
  apiKeyFrom(env) { return env.VOYAGE_API_KEY ?? null; },
  async embed(params: EmbeddingGenParams): Promise<EmbeddingGenResult> {
    return executeEmbeddings({
      vendorId: 'voyage',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseOpenAIEmbeddings('voyage', params.model, raw),
    });
  },
};
