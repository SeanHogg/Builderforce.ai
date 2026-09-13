import type { ReasoningChain, ReasoningReplayStore } from '../../application/llm/vendors/reasoningReplay';
import { peekCached, setCached, type CacheEnv } from './readThroughCache';

/**
 * Grok's reasoning chains (`application/llm/vendors/reasoningReplay.ts`), kept in the
 * platform cache — the same L1 + KV the rest of the API reads through.
 *
 * A chain is written once per completed tool turn and read by a later request of the
 * same loop, so it is a write-then-read record, not a loader-backed read. The TTL is
 * long enough for a person to step away mid-task and say "continue"; after that the
 * loop simply restarts its reasoning, which is what every request did before this.
 */
const REASONING_REPLAY_TTL_SECONDS = 6 * 60 * 60;
/** The isolate copy: the next request of a loop usually lands seconds later. */
const REASONING_REPLAY_L1_MS = 5 * 60 * 1000;

export function reasoningReplayStore(env: CacheEnv): ReasoningReplayStore {
  return {
    load: (key) => peekCached<ReasoningChain>(env, key),
    save: (key, chain) => setCached(env, key, chain, { kvTtlSeconds: REASONING_REPLAY_TTL_SECONDS, l1TtlMs: REASONING_REPLAY_L1_MS }),
  };
}
