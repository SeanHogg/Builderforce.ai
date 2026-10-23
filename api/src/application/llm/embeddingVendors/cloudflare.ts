/**
 * Cloudflare Workers AI embeddings vendor module — BGE text embedders on the account's
 * own Workers AI quota, via the native REST endpoint the chat and image Cloudflare
 * vendors already use:
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/<id>/ai/run/<model>
 *   { text: string[] }  →  { result: { shape: [n, d], data: number[][] }, success: true }
 *
 * Authenticates with the same `<token>::<accountId>` sentinel as `vendors/cloudflare.ts`
 * and `imageVendors/cloudflare.ts` (CLOUDFLARE_AI_API_TOKEN + CLOUDFLARE_ACCOUNT_ID);
 * either half missing reads as "unbound" and the cascade skips it.
 *
 * DIMENSIONS DIFFER from the OpenRouter models (bge-m3 / bge-large = 1024, bge-base =
 * 768, bge-small = 384). This vendor serves the general `/v1/embeddings` cascade, whose
 * callers receive `model` with every vector. It is NOT a fallback for the memory store's
 * `vector(1536)` column (pinned to `openrouter/openai/text-embedding-3-small`); bge-m3
 * has its OWN memory column, `embedding_1024` (1256, cost lever `e3_free_embeddings`) —
 * see `application/memory/memoryEmbedding.ts`.
 */

import {
  VendorFatalError,
  VendorRetryableError,
  executeEmbeddings,
  type EmbeddingGenParams,
  type EmbeddingGenResult,
  type EmbeddingVendorModelEntry,
  type EmbeddingVendorModule,
} from './types';

/** Multilingual, 8K-token context, 1024 dimensions — the default. */
export const DEFAULT_CLOUDFLARE_EMBEDDING_MODEL = '@cf/baai/bge-m3';

const CATALOG: ReadonlyArray<EmbeddingVendorModelEntry> = [
  { id: DEFAULT_CLOUDFLARE_EMBEDDING_MODEL,  label: 'BGE M3 (Cloudflare)',         brand: 'BAAI', dimensions: 1024 },
  { id: '@cf/baai/bge-large-en-v1.5',        label: 'BGE Large EN v1.5 (Cloudflare)', brand: 'BAAI', dimensions: 1024 },
  { id: '@cf/baai/bge-base-en-v1.5',         label: 'BGE Base EN v1.5 (Cloudflare)',  brand: 'BAAI', dimensions: 768 },
  { id: '@cf/baai/bge-small-en-v1.5',        label: 'BGE Small EN v1.5 (Cloudflare)', brand: 'BAAI', dimensions: 384 },
];

/** The Workers AI credential pair, or null when either half is unset. Shared with the
 *  reranker (`application/llm/reranker.ts`), which runs on the same account quota. */
export function workersAiCredentials(env: { CLOUDFLARE_AI_API_TOKEN?: string | null; CLOUDFLARE_ACCOUNT_ID?: string | null }): { token: string; accountId: string } | null {
  const token = env.CLOUDFLARE_AI_API_TOKEN ?? null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? null;
  return token && accountId ? { token, accountId } : null;
}

/** The native `/ai/run/<model>` endpoint for one account. */
export function workersAiRunEndpoint(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}

export function buildCloudflareEmbeddingBody(params: EmbeddingGenParams): Record<string, unknown> {
  return {
    text: Array.isArray(params.input) ? params.input : [params.input],
    ...(params.extraBody ?? {}),
  };
}

/**
 * Normalise Workers AI's `{ result: { data: number[][] } }` into the OpenAI-shaped
 * envelope every embeddings caller reads. A 200 without vectors is retryable so the
 * cascade advances, exactly like the OpenAI-shaped parser.
 */
export function parseCloudflareEmbeddings(model: string, raw: unknown): EmbeddingGenResult {
  const r = raw as { result?: { data?: unknown }; data?: unknown } | null;
  const rows = Array.isArray(r?.result?.data) ? r!.result!.data as unknown[] : Array.isArray(r?.data) ? r!.data as unknown[] : [];
  const vectors = rows.filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (vectors.length === 0) {
    throw new VendorRetryableError('cloudflare', model, 502, 'embedded:empty: cloudflare returned 200 with no embedding data');
  }
  return {
    object: 'list',
    data: vectors.map((embedding, index) => ({ object: 'embedding' as const, embedding, index })),
    model,
    raw,
  };
}

export const cloudflareEmbeddingModule: EmbeddingVendorModule = {
  id: 'cloudflare',
  catalog: CATALOG,
  defaultModel: DEFAULT_CLOUDFLARE_EMBEDDING_MODEL,
  apiKeyFrom(env) {
    const creds = workersAiCredentials(env);
    return creds ? `${creds.token}::${creds.accountId}` : null;
  },
  async embed(params: EmbeddingGenParams): Promise<EmbeddingGenResult> {
    const [token, accountId] = params.apiKey.split('::');
    if (!token || !accountId) {
      throw new VendorFatalError('cloudflare', 500, 'malformed cloudflare apiKey sentinel (expected "<token>::<accountId>")');
    }
    return executeEmbeddings({
      vendorId: 'cloudflare',
      endpoint: workersAiRunEndpoint(accountId, params.model),
      apiKey: token,
      model: params.model,
      body: buildCloudflareEmbeddingBody(params),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      parseResponse: (raw) => parseCloudflareEmbeddings(params.model, raw),
    });
  },
};
