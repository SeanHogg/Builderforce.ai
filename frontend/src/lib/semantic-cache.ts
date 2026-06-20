/**
 * Semantic response cache for the web app — the browser twin of the agent-runtime's
 * server-side cortex cache (`SsmMemoryService.getCachedOrGenerate`). A semantically
 * repeated cloud-inference prompt returns a prior answer instead of re-billing the
 * frontier model.
 *
 * It is **read-through with two tiers** (L1 in-process SSM-embedding vector list; L2 an
 * optional shared backend) and **gracefully optional**: the embedder is an on-device
 * WebGPU SSM, so when WebGPU (or the tokenizer/model assets) are absent the cache is
 * simply `null` and every call falls through to the network — never an error. The heavy
 * runtime is loaded via dynamic `import()` so it stays out of the main bundle (mirrors
 * how `MambaModelProvider` lazy-loads the engine).
 */

import type { SemanticCache } from '@seanhogg/builderforce-memory';

/** True only where an on-device WebGPU SSM embedder can exist. Shared with
 *  `MambaModelProvider` so the WebGPU gate lives in exactly one place (DRY). */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Cosine-similarity threshold above which a stored answer is reused. */
const DEFAULT_THRESHOLD = 0.92;

let cachePromise: Promise<SemanticCache | null> | undefined;

/**
 * Lazily build (once) the semantic response cache backed by an on-device SSM embedder.
 * Returns `null` when WebGPU / the SSM runtime / its assets are unavailable, so callers
 * degrade to a direct network call.
 */
export function getSemanticResponseCache(): Promise<SemanticCache | null> {
  return (cachePromise ??= buildSemanticResponseCache());
}

async function buildSemanticResponseCache(): Promise<SemanticCache | null> {
  if (!hasWebGPU()) return null;
  try {
    const mod = await import('@seanhogg/builderforce-memory');
    // Browser uses the global WebGPU/IndexedDB automatically; modelSize keeps the
    // embedding model light. Asset/WebGPU failures throw → caught → null (no cache).
    const runtime = await mod.SSM.create({ session: { modelSize: 'small' } });
    return new mod.SemanticCache({
      embed: (text: string) => runtime.embed(text),
      threshold: DEFAULT_THRESHOLD,
    });
  } catch (err) {
    console.warn('[semantic-cache] unavailable — cloud responses uncached:', err);
    return null;
  }
}

/**
 * Run `generate` through `cache` (read-through), falling back to a direct call when the
 * cache is absent or errors. Pure w.r.t. the cache instance so it is unit-testable with
 * a mock — `getSemanticResponseCache()` supplies the real (or null) instance in prod.
 */
export async function runThroughCache(
  cache: SemanticCache | null,
  query: string,
  generate: () => Promise<string>,
): Promise<{ response: string; cached: boolean }> {
  if (!cache) return { response: await generate(), cached: false };
  try {
    const r = await cache.getOrGenerate(query, generate);
    return { response: r.response, cached: r.cached };
  } catch {
    // Caching must never break a real call.
    return { response: await generate(), cached: false };
  }
}

/** Read-through wrapper bound to the app's lazily-built cache. */
export async function withSemanticResponseCache(
  query: string,
  generate: () => Promise<string>,
): Promise<{ response: string; cached: boolean }> {
  return runThroughCache(await getSemanticResponseCache(), query, generate);
}

/** Reset the memoised cache (tests / disposal). */
export function resetSemanticResponseCache(): void {
  cachePromise = undefined;
}
