/**
 * ON-DEVICE memory for the shared Brain — a memory tier that answers from the user's
 * own machine, with no server in the path at all.
 *
 * WHAT WAS MISSING. `evermindMemory.ts` describes memory hooks whose "heavy lifting
 * lives server-side": recall, the Q&A cache and the Evermind SSM are all HTTP calls
 * bound to a project. The in-browser SSM — the WebGPU Mamba runtime the app already
 * ships for the agent-publish stack — was never reachable from the Brain, so a repeat
 * question always cost a round trip even when the answer was already sitting in the
 * tab that asked it. That is the "on-device inference isn't in the shared Brain" gap.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. It is a SEMANTIC ANSWER CACHE keyed by an
 * on-device embedding: a question close enough to one this browser already answered
 * replays that answer, locally. It is NOT a second Evermind and it does not generate:
 * the in-browser SSM is an embedder here, not a chat model, and a tier that invented
 * answers from small local weights would be strictly worse than the model it pre-empts.
 * So a hit is reported as `qa-cache` — the honest provenance, the same one the server's
 * exact-repeat cache reports — and the timeline says a cached answer served, never that
 * a local model wrote one.
 *
 * WHY IT IS SAFE TO PUT IN FRONT. The threshold is the whole argument. The server's
 * Q&A cache replays on an EXACT repeat; a semantic cache at its usual 0.92 would replay
 * on a paraphrase, and "which tickets are in the backlog?" asked twice about different
 * boards is a paraphrase. {@link ON_DEVICE_ANSWER_THRESHOLD} is therefore set at
 * near-identity, making this a restatement cache rather than a similarity cache.
 *
 * Pure and transport-agnostic, like the rest of this package: the STORE is injected, so
 * the SSM runtime, WebGPU detection and any shared L2 stay in the host that has them,
 * and this module is safe in every bundle including ones with no GPU story at all.
 */

import type { EvermindRunHooks, MemoryFirstAnswer } from './evermindMemory';

/**
 * The on-device answer store, as a port. Structurally satisfied by the
 * `SemanticCache` in `@seanhogg/builderforce-memory`, which is what the web host
 * injects — declared here as a shape so this package takes no dependency on it.
 */
export interface OnDeviceAnswerStore {
  /** Best stored answer for a semantically-similar prior question, or undefined. */
  lookup(query: string): Promise<{ response: string; score: number } | undefined>;
  /** Remember a (question → answer) pair. */
  store(query: string, response: string): Promise<void>;
}

/**
 * Cosine similarity at/above which a stored local answer is replayed.
 *
 * Deliberately far above the 0.92 the response cache uses for cloud completions. That
 * cache is protecting a bill; this one is answering a person, and the cost of being
 * wrong is not a wasted call but a confidently stale answer to a question nobody
 * re-asked. At this threshold a hit means "you asked this again", not "you asked
 * something like this".
 */
export const ON_DEVICE_ANSWER_THRESHOLD = 0.985;

/**
 * Build the on-device half of the Brain's memory hooks from a lazily-loaded store.
 *
 * `load` is called at most once per turn and may return null forever (no WebGPU, no
 * SSM assets, a runtime that cannot spawn a worker) — every hook then answers "I have
 * nothing", which is exactly what makes this safe to place in front of the server tier.
 * Nothing here throws: a memory tier that can fail a turn is worse than no memory tier.
 */
export function onDeviceMemoryHooks(
  load: () => Promise<OnDeviceAnswerStore | null>,
): Pick<EvermindRunHooks, 'answer' | 'cacheAnswer'> {
  const store = async (): Promise<OnDeviceAnswerStore | null> => {
    try {
      return await load();
    } catch {
      return null;
    }
  };
  return {
    answer: async (query: string): Promise<MemoryFirstAnswer | null> => {
      // `toolsAvailable` is deliberately unused: it gates the SERVER's SSM leg, which
      // generates. This tier only replays an answer a real model already produced, so
      // it is no less valid on a run that can call tools than the server's Q&A cache is.
      const cache = await store();
      if (!cache) return null;
      try {
        const hit = await cache.lookup(query);
        if (!hit || hit.score < ON_DEVICE_ANSWER_THRESHOLD || !hit.response.trim()) return null;
        return { text: hit.response, source: 'qa-cache' };
      } catch {
        return null;
      }
    },
    cacheAnswer: async (query: string, answer: string): Promise<void> => {
      const cache = await store();
      if (!cache) return;
      try {
        await cache.store(query, answer);
      } catch {
        /* best-effort: never fail a turn to remember it */
      }
    },
  };
}

/**
 * Layer memory hooks into one set, nearest-first.
 *
 * The layers are tiers, and the order IS the policy: ask the cheapest, most local
 * source first and fall through. `recall` comes from the first layer that has one
 * (grounding is the project corpus's job — a local answer cache has no corpus to
 * ground with). `answer` walks the layers until one answers. `cacheAnswer` writes to
 * ALL of them, because a turn the server remembers should also be the turn this
 * browser can replay offline, and vice versa.
 *
 * Returns undefined when no layer supplies anything, so a host can pass the result
 * straight through to the run loop's optional `evermind` prop.
 */
export function composeEvermindHooks(
  ...layers: (Partial<EvermindRunHooks> | null | undefined)[]
): EvermindRunHooks | undefined {
  const present = layers.filter((l): l is Partial<EvermindRunHooks> => !!l);
  const recall = present.find((l) => l.recall)?.recall;
  const answering = present.filter((l) => l.answer);
  const caching = present.filter((l) => l.cacheAnswer);
  if (!recall && answering.length === 0 && caching.length === 0) return undefined;
  return {
    recall: recall ?? (async () => null),
    ...(answering.length
      ? {
          answer: async (query: string, opts: { toolsAvailable: boolean }) => {
            for (const layer of answering) {
              const hit = await layer.answer?.(query, opts);
              if (hit) return hit;
            }
            return null;
          },
        }
      : {}),
    ...(caching.length
      ? {
          cacheAnswer: (query: string, answer: string) => {
            for (const layer of caching) {
              void Promise.resolve(layer.cacheAnswer?.(query, answer)).catch(() => {
                /* best-effort per layer; one tier failing must not stop the others */
              });
            }
          },
        }
      : {}),
  };
}
