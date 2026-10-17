/**
 * The SHARED BRAIN's on-device answer memory — an SSM-embedding semantic cache that
 * answers a near-identical question WITHOUT a server in the path.
 *
 * It differs from the cross-surface semantic response cache (the agent-runtime's
 * `SsmMemoryService.getCachedOrGenerate`, backed by the api's `/semantic-cache` index)
 * on purpose:
 *
 *   • **No L2.** This tier exists to answer without a server; a shared backend would put
 *     one back and would also duplicate the server-side Q&A cache the Brain already
 *     consults on the next tier down.
 *   • **A near-identity threshold** ({@link ON_DEVICE_ANSWER_THRESHOLD}) instead of a
 *     paraphrase-tolerant one — a memory answering a person is held to a stricter bar
 *     than one avoiding a bill.
 *
 * Gracefully optional: the embedder is an on-device WebGPU SSM, so when WebGPU (or the
 * tokenizer/model assets) are absent the memory is simply `null` and the Brain falls
 * through to its server tier — never an error. The heavy runtime is loaded via dynamic
 * `import()` so it stays out of the main bundle.
 */

import type { SemanticCache } from '@seanhogg/builderforce-memory';
import { hasWebGPU, ON_DEVICE_ANSWER_THRESHOLD } from '@seanhogg/builderforce-brain-embedded';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

const BRAIN_CACHE_KEY = 'semantic-response-cache:brain-on-device';

/** Lazily build (once) the Brain's on-device answer memory; null when unavailable. */
export function getOnDeviceAnswerMemory(): Promise<SemanticCache | null> {
  return getOrSetClientCached(BRAIN_CACHE_KEY, buildOnDeviceAnswerMemory);
}

async function buildOnDeviceAnswerMemory(): Promise<SemanticCache | null> {
  if (!hasWebGPU()) return null;
  try {
    const mod = await import('@seanhogg/builderforce-memory');
    // Browser uses the global WebGPU/IndexedDB automatically; modelSize keeps the
    // embedding model light. Asset/WebGPU failures throw → caught → null (no memory).
    const runtime = await mod.SSM.create({ session: { modelSize: 'small' } });
    return new mod.SemanticCache({
      embed: (text: string) => runtime.embed(text),
      threshold: ON_DEVICE_ANSWER_THRESHOLD,
      ttlMs: 24 * 60 * 60 * 1_000,
    });
  } catch (err) {
    console.warn('[semantic-cache] unavailable — on-device memory off:', err);
    return null;
  }
}
