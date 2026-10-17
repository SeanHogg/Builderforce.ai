/**
 * What memory did to a model call, as the run loop measures it — carried TO the gateway
 * inside the `metadata` the call already sends, never in a request of its own.
 *
 * Only the loop can measure these, because only it holds the transcript:
 *   trimmedTokens — prompt tokens compaction kept out of this call (the full transcript
 *                   vs the compacted working set it actually sent);
 *   recallTokens  — prompt tokens the recalled-memory block ADDED to this call.
 * The gateway's usage writer stamps them on this call's own `llm_usage_log` row
 * (`readMemoryEffect`), priced at the model that served it. Replays (a cached or
 * Evermind answer) are recorded by the server where they happen.
 */

/** The `metadata.memory` block one model call carries. */
export interface CallMemoryEffect {
  trimmedTokens: number;
  recallTokens: number;
}

/** The block for one call, or undefined when memory did nothing to it (sent nothing). */
export function callMemoryEffect(trimmedTokens: number, recallTokens: number): CallMemoryEffect | undefined {
  const t = Math.max(0, Math.round(trimmedTokens));
  const r = Math.max(0, Math.round(recallTokens));
  return t > 0 || r > 0 ? { trimmedTokens: t, recallTokens: r } : undefined;
}

/** A run's summed usage — the production cost its answer is cached with, so a later
 *  replay of that answer is priced from a recorded figure. */
export interface RunUsageTally {
  promptTokens: number;
  completionTokens: number;
  /** The last model that actually served a call in this run. */
  model: string | null;
}

export function emptyRunUsage(): RunUsageTally {
  return { promptTokens: 0, completionTokens: 0, model: null };
}
