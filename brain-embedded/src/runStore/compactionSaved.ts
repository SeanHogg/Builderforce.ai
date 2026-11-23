/**
 * The prompt tokens compaction kept out of ONE model call — the `trimmedTokens` half of
 * the call's memory effect (`memorySavings.ts`).
 *
 * The honest baseline is NOT the whole transcript: without compaction the run would still
 * have sent at most {@link HISTORY_TOKEN_BUDGET} (the drop-oldest window caps it), so the
 * saving is what compaction bought below THAT, never the transcript's full length. Never
 * negative — a working set larger than the baseline saved nothing.
 */

export { compactionSavedTokens } from '@builderforce/agent-run';

/**
 * Hands out `stamped` to the FIRST request of a call and `plain` to every later one (a
 * transport retry, the coder re-ask) — the memory effect is one call's saving, recorded
 * on one usage row, never once per attempt.
 */
export function stampOncePerCall<T>(stamped: T, plain: T): () => T {
  let used = false;
  return () => {
    if (used) return plain;
    used = true;
    return stamped;
  };
}
