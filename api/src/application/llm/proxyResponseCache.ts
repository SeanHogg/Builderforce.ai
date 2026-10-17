/**
 * The gateway's EXACT-MATCH response-cache step — key derivation, the cache-hit
 * result, and the post-success store. Split out of `LlmProxyService.ts`; the cache
 * itself (`responseCache.ts`) is unchanged.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isCacheableRequest, responseCacheKey, readCachedResponse, storeCachedResponse } from './responseCache';
import type { VendorId } from './vendors';
import type { ChatCompletionRequest, LlmUsage, ProxyEnv, ProxyResult } from './proxyTypes';

/** The usage block a stored chat-completion body carries, in ledger shape — or
 *  undefined when the upstream reported none. */
function cachedUsageOf(body: unknown): LlmUsage | undefined {
  const u = (body as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } } | null)?.usage;
  if (!u) return undefined;
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
  const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
  if (prompt + completion <= 0) return undefined;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion,
  };
}

/**
 * The exact-match cache key for this request, or null when it must not be cached.
 *
 * Opt-in twice over: the CALLER must pass `responseCache` (so no internal path
 * caches by accident) and the request must independently qualify — an idempotent
 * `useCase`, low temperature, no tools, not streaming (see `isCacheableRequest`).
 * This is the cheap tier beneath the semantic cache: an exact repeat costs a hash
 * and an L1 hit, where a paraphrase costs an embedding.
 *
 * The whole classify/extract/score family re-asks identical questions across
 * sweep ticks and retries; each one used to be a full metered dispatch.
 */
export async function responseCacheKeyFor(
  body: ChatCompletionRequest,
  cacheTenantId: number | undefined,
): Promise<string | null> {
  const cacheable = cacheTenantId != null && isCacheableRequest({
    useCase: typeof (body as unknown as { useCase?: unknown }).useCase === 'string'
      ? (body as unknown as { useCase: string }).useCase : null,
    temperature: typeof (body as { temperature?: unknown }).temperature === 'number'
      ? (body as { temperature: number }).temperature : null,
    hasTools: Array.isArray((body as unknown as { tools?: unknown }).tools)
      && ((body as unknown as { tools: unknown[] }).tools.length > 0),
    streaming: (body as { stream?: unknown }).stream === true,
  });
  return cacheable
    ? await responseCacheKey({
        tenantId: cacheTenantId,
        model: typeof (body as { model?: unknown }).model === 'string' ? (body as { model: string }).model : undefined,
        messages: (body as { messages?: unknown }).messages,
        maxTokens: (body as { max_tokens?: number }).max_tokens,
        temperature: (body as { temperature?: number }).temperature,
        topP: (body as { top_p?: number }).top_p,
        responseFormat: (body as { response_format?: unknown }).response_format,
      })
    : null;
}

/** A cache hit as an (un-finalized) ProxyResult, or null on a miss. */
export async function readResponseCacheHit(env: ProxyEnv, cacheKey: string): Promise<ProxyResult | null> {
  const hit = await readCachedResponse(env, cacheKey);
  if (!hit) return null;
  // `retries: 0` and `failovers: []` are the TRUTH for a cache hit — nothing was
  // dispatched. `outcome` names it so a trace never reads as a fresh call, and
  // no usage row should be written for it by the caller.
  const cachedUsage = cachedUsageOf(hit.body);
  return {
    response: new Response(JSON.stringify(hit.body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-builderforce-cache': 'hit' },
    }),
    resolvedModel: hit.resolvedModel,
    resolvedVendor: hit.resolvedVendor as VendorId,
    retries: 0,
    failovers: [],
    outcome: 'response_cache_hit',
    attempts: [],
    byoFunded: false,
    platformSurcharge: false,
    ...(cachedUsage ? { cachedUsage } : {}),
  };
}

/**
 * Persist a successful completion into the exact-match response cache.
 *
 * CLONES the response before reading it: a `Response` body can be consumed once,
 * and the original is what the caller is about to read. Reading it here without a
 * clone would hand the caller an empty body — a cache that breaks the very request
 * it was trying to make cheaper.
 */
export async function storeInResponseCache(env: ProxyEnv, key: string, result: ProxyResult): Promise<void> {
  try {
    const body = await result.response.clone().json();
    await storeCachedResponse(env, key, {
      body,
      resolvedModel: result.resolvedModel,
      resolvedVendor: result.resolvedVendor,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/LlmProxyService.ts', operation: 'storeInResponseCache' });
  }
}
