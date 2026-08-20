/**
 * EXACT-MATCH RESPONSE CACHE for the gateway's read path.
 *
 * The register asks for `builderforce-memory`'s `CachingBridge` / `ResponseCache` to
 * be wired into the gateway and agent-runtime read paths. Those classes cannot run
 * here, and the reason is structural rather than incidental: `CachingBridge` decorates
 * a `TransformerBridge` (a `generate(prompt)` interface over a local model), the
 * gateway speaks OpenAI chat-completions with tools and multi-part content, and the
 * Worker bundle cannot pull that package's WebGPU engine at all — the same constraint
 * that made `semanticCache.ts` re-implement cosine similarity in `vectorMath`.
 *
 * So this is that BEHAVIOUR, implemented for this runtime: `buildCacheKey` over the
 * same fields (prompt, model, system, maxTokens, temperature, topP), a bounded
 * read-through cache, and exact-match only. It is the cheap tier that sits UNDER the
 * semantic cache — an exact repeat costs a hash and an L1 hit, where a paraphrase
 * costs an embedding.
 *
 * ── WHEN IT IS ALLOWED TO ANSWER ───────────────────────────────────────────
 * Never by accident. A cached completion is only correct when the same request would
 * have produced an equivalent answer, so three conditions must ALL hold:
 *
 *   1. LOW TEMPERATURE. Above {@link MAX_CACHEABLE_TEMPERATURE} the caller is asking
 *      for variety, and serving them the same bytes twice is a defect, not a saving.
 *   2. AN IDEMPOTENT USE CASE. The caller declares it (`useCase`), and only a
 *      curated set qualifies — classification, extraction, scoring: questions whose
 *      answer is a property of the input. A chat turn never qualifies, because its
 *      answer is a property of the conversation.
 *   3. NO TOOLS, NO STREAM. A tool call is a request to DO something; replaying one
 *      from cache would replay an effect. Streaming has no single body to store.
 *
 * ── TENANT ISOLATION ───────────────────────────────────────────────────────
 * The key is tenant-scoped. Not for correctness of the ANSWER — the same prompt to
 * the same model does yield the same answer for anyone — but because a cache shared
 * across tenants leaks the existence and content of one tenant's prompts to another
 * through timing and through the response itself. Cross-tenant sharing would be a
 * confidentiality decision, not a performance one, and it is not this module's to make.
 */

import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';

/**
 * The narrow env slice this needs. Widened from `Env` on purpose: the LLM proxy runs
 * with a `ProxyEnv` (no NEON/JWT/CORS), and demanding the full `Env` here would force
 * every caller — including tests — to fabricate bindings the cache never touches. The
 * read-through cache itself only reads `AUTH_CACHE_KV`.
 */
export interface ResponseCacheEnv {
  AUTH_CACHE_KV?: KVNamespace;
}

const asEnv = (env: ResponseCacheEnv): Env => env as unknown as Env;

/** Above this, the caller wants variety and a repeat answer is a defect. */
export const MAX_CACHEABLE_TEMPERATURE = 0.2;

/**
 * Use cases whose answer is a property of the INPUT rather than of a conversation.
 *
 * Deliberately an allow-list. `useCase` is caller-supplied, so an inferred or
 * pattern-matched rule would let any caller opt themselves into caching by naming
 * their request something that happened to match — and a wrongly cached chat turn is
 * a user-visible bug that is very hard to trace back to here.
 */
export const CACHEABLE_USE_CASES: ReadonlySet<string> = new Set([
  'classification',
  'classify_task',
  'action_type',
  'extraction',
  'embedding_text',
  'text_coherence',
  'model_quality_score',
  'repo_analysis_summary',
  'schema_extract',
]);

/** TTL for a cached completion. Long enough to absorb a retry storm or a re-run of
 *  the same sweep; short enough that a model or prompt change washes through fast. */
const RESPONSE_CACHE_TTL_SECONDS = 15 * 60;

export interface ResponseCacheKeyParts {
  tenantId: number;
  /** The model as REQUESTED, not as resolved — a cascade may land elsewhere, and two
   *  requests that asked for different models are different questions. */
  model: string | undefined;
  messages: unknown;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  topP?: number | undefined;
  responseFormat?: unknown;
}

/** Stable JSON — object keys sorted at every depth — so two structurally identical
 *  requests hash the same regardless of the order their fields were built in. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The cache key for one request. Mirrors `builderforce-memory`'s `buildCacheKey`
 * field set, plus the tenant and the response format (a strict schema changes the
 * answer's SHAPE, so two requests differing only in it are different questions).
 */
export async function responseCacheKey(parts: ResponseCacheKeyParts): Promise<string> {
  const canonical = stableStringify({
    model: parts.model ?? '',
    messages: parts.messages,
    maxTokens: parts.maxTokens,
    temperature: parts.temperature,
    topP: parts.topP,
    responseFormat: parts.responseFormat,
  });
  return `respcache:${parts.tenantId}:${await sha256Hex(canonical)}`;
}

export interface CacheEligibilityInput {
  useCase: string | null | undefined;
  temperature: number | null | undefined;
  hasTools: boolean;
  streaming: boolean;
}

/**
 * May this request read from / write to the cache? PURE, so the policy is testable
 * without a Worker, a KV binding, or a model.
 *
 * An ABSENT temperature counts as eligible: the vendor default for these use cases is
 * low, and requiring an explicit `temperature: 0` would exclude nearly every caller
 * that qualifies on every other ground.
 */
export function isCacheableRequest(input: CacheEligibilityInput): boolean {
  if (input.streaming || input.hasTools) return false;
  if (!input.useCase || !CACHEABLE_USE_CASES.has(input.useCase)) return false;
  if (input.temperature != null && input.temperature > MAX_CACHEABLE_TEMPERATURE) return false;
  return true;
}

/** What is stored: the raw upstream JSON body plus the model that produced it. */
export interface CachedResponse {
  /** The upstream chat-completion body, verbatim. */
  body: unknown;
  resolvedModel: string;
  resolvedVendor: string;
  /** When it was stored — surfaced to the caller so a cached answer is never
   *  mistaken for a fresh one in a trace. */
  at: number;
}

/**
 * Read a cached completion, or `null`.
 *
 * Uses `peekCached` rather than `getOrSetCached`: there is no loader to run on a
 * miss, and turning a miss into a dispatch here would put request execution inside a
 * cache module. The caller dispatches and calls {@link storeCachedResponse}.
 */
export async function readCachedResponse(env: ResponseCacheEnv, key: string): Promise<CachedResponse | null> {
  try {
    const hit = await peekCached<CachedResponse>(asEnv(env), key);
    return hit && typeof hit === 'object' && 'body' in hit ? hit : null;
  } catch (error) {
    // A cache read must never fail a request — degrade to a miss.
    reportCaughtError(error, { source: 'application/llm/responseCache.ts', operation: 'readCachedResponse' });
    return null;
  }
}

/** Store a completion. Best-effort — a failed write costs a cache miss, nothing more. */
export async function storeCachedResponse(
  env: ResponseCacheEnv,
  key: string,
  value: Omit<CachedResponse, 'at'>,
): Promise<void> {
  try {
    await setCached(asEnv(env), key, { ...value, at: Date.now() }, { kvTtlSeconds: RESPONSE_CACHE_TTL_SECONDS });
  } catch (error) {
    // Best-effort: a failed store costs a future cache miss and nothing else, so it
    // must never propagate into the request that just succeeded.
    reportCaughtError(error, { source: 'application/llm/responseCache.ts', operation: 'storeCachedResponse' });
  }
}

/**
 * Read-through convenience for callers that have a loader in hand — the shape
 * `CachingBridge` presents. Kept separate from the read/write pair above because the
 * gateway needs them apart (it must dispatch, meter, and only THEN decide to store).
 */
export async function getCachedOrGenerate(
  env: ResponseCacheEnv,
  key: string,
  generate: () => Promise<Omit<CachedResponse, 'at'>>,
): Promise<{ value: CachedResponse; cached: boolean }> {
  const hit = await readCachedResponse(env, key);
  if (hit) return { value: hit, cached: true };
  const fresh = await getOrSetCached<CachedResponse>(
    asEnv(env),
    key,
    async () => ({ ...(await generate()), at: Date.now() }),
    { kvTtlSeconds: RESPONSE_CACHE_TTL_SECONDS },
  );
  return { value: fresh, cached: false };
}
