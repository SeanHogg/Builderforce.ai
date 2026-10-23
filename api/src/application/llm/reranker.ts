/**
 * Cross-encoder reranking for hybrid recall (PRD C6, cost lever `c6_rerank`).
 *
 * The 0.7/0.3 fusion in `fuseHybridArms` ranks by two cheap signals — cosine similarity
 * and "did a keyword match" — neither of which reads the query and the candidate
 * TOGETHER. A cross-encoder does, which is what lets the cut shrink to the top 3 without
 * losing the right fact: fewer, better rows reach the prompt.
 *
 * The model is Workers AI `@cf/baai/bge-reranker-base` on the account's own quota, called
 * through the same native `/ai/run/<model>` endpoint and the same token + account pair as
 * the BGE embedder (`embeddingVendors/cloudflare.ts`). The `Reranker` port keeps the
 * transport swappable (tests inject one).
 *
 * Failure is never fatal and never silent: an unbound account or a failed call is logged
 * and `rerankCandidates` returns `null`, which the caller reads as "keep the fused order".
 */
import { executeVendorPost } from './vendors/types';
import { VendorFatalError, VendorRetryableError } from './embeddingVendors/types';
import { workersAiCredentials, workersAiRunEndpoint } from './embeddingVendors/cloudflare';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export const RERANK_MODEL = '@cf/baai/bge-reranker-base';
/** Candidates sent per call — the fused pool is already ×4 the caller's K. */
export const RERANK_MAX_CANDIDATES = 32;
/** bge-reranker-base reads ~512 tokens of query + passage; longer text is truncated. */
export const RERANK_MAX_CHARS = 2000;
const RERANK_TIMEOUT_MS = 5_000;

/** The port: one relevance score per document, aligned with `documents`. Throws on failure. */
export interface Reranker {
  rerank(query: string, documents: readonly string[]): Promise<number[]>;
}

export interface RerankDeps {
  /** Override the transport (tests). Omitted = Workers AI when bound. */
  reranker?: Reranker | null;
}

/** Parse `{ result: { response: [{ id, score }] } }` into scores aligned with the input. */
export function parseRerankResponse(raw: unknown, count: number): number[] {
  const r = raw as { result?: { response?: unknown }; response?: unknown } | null;
  const rows = Array.isArray(r?.result?.response) ? (r!.result!.response as unknown[]) : Array.isArray(r?.response) ? (r!.response as unknown[]) : [];
  if (rows.length === 0) throw new VendorRetryableError('cloudflare', RERANK_MODEL, 502, 'embedded:empty: reranker returned no scores');
  const scores = Array.from({ length: count }, () => 0);
  for (const row of rows) {
    const { id, score } = (row ?? {}) as { id?: unknown; score?: unknown };
    const index = Number(id);
    const value = Number(score);
    if (Number.isInteger(index) && index >= 0 && index < count && Number.isFinite(value)) scores[index] = value;
  }
  return scores;
}

/** The Workers AI reranker, or null when the account pair is not configured. */
export function workersAiReranker(env: unknown): Reranker | null {
  const creds = workersAiCredentials((env ?? {}) as { CLOUDFLARE_AI_API_TOKEN?: string | null; CLOUDFLARE_ACCOUNT_ID?: string | null });
  if (!creds) return null;
  return {
    rerank: (query, documents) =>
      executeVendorPost<number[]>({
        vendorId: 'cloudflare',
        endpoint: workersAiRunEndpoint(creds.accountId, RERANK_MODEL),
        apiKey: creds.token,
        model: RERANK_MODEL,
        body: { query, contexts: documents.map((text) => ({ text })), top_k: documents.length },
        timeoutMs: RERANK_TIMEOUT_MS,
        logPrefix: 'reranker',
        authFailoverNoun: 'vendor',
        parseResponse: (raw) => parseRerankResponse(raw, documents.length),
        onEmbeddedError: (vendorId, model, msg): never => {
          throw new VendorRetryableError(vendorId, model, 0, `embedded: ${msg}`);
        },
        onFatal: (vendorId, _model, status, errText): never => {
          throw new VendorFatalError(vendorId, status, errText);
        },
      }),
  };
}

let warnedUnbound = false;

/**
 * Score `documents` against `query`. Returns scores aligned with `documents` (candidates
 * past {@link RERANK_MAX_CANDIDATES} score 0), or `null` — logged — when there is no
 * reranker or the call failed, so the caller keeps the fused order.
 */
export async function rerankCandidates(
  env: unknown,
  query: string,
  documents: readonly string[],
  deps?: RerankDeps,
): Promise<number[] | null> {
  const q = query.trim();
  if (!q || documents.length === 0) return null;
  const reranker = deps?.reranker !== undefined ? deps.reranker : workersAiReranker(env);
  if (!reranker) {
    if (!warnedUnbound) {
      warnedUnbound = true;
      console.warn('[reranker] c6_rerank is on but Workers AI is not configured (CLOUDFLARE_AI_API_TOKEN + CLOUDFLARE_ACCOUNT_ID); keeping the fused order');
    }
    return null;
  }
  const sent = documents.slice(0, RERANK_MAX_CANDIDATES).map((d) => d.slice(0, RERANK_MAX_CHARS));
  try {
    const scores = await reranker.rerank(q.slice(0, RERANK_MAX_CHARS), sent);
    if (scores.length !== sent.length) throw new Error(`reranker returned ${scores.length} scores for ${sent.length} documents`);
    return documents.map((_, i) => (i < scores.length && Number.isFinite(scores[i]) ? scores[i]! : 0));
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/reranker.ts', operation: 'rerankCandidates', level: 'warning' });
    return null;
  }
}

/** Test seam: forget the one-time "not configured" warning. */
export function __resetRerankerWarningForTests(): void {
  warnedUnbound = false;
}
