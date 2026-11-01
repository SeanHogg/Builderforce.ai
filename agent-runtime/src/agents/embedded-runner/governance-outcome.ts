/**
 * What an attempt learned about governance, read by the run loop:
 *   - `governanceRefusals`: the ids of the gates that refused a tool call (the structured `policy.blocked` path, relayed by the
 *     session's `onGovernanceRefusal`), so a caller can say which gate stopped a run (a memory flush that wrote nothing);
 *   - whether the run may be AUTO-CONTINUED. Continuing a run a gate refused, or one that ended failed (budget or breaker), re-runs
 *     the very calls that were refused, so neither is continued.
 */
import type { AssistantMessage } from "../../builderforce/model/types.js";

export interface GovernanceOutcome {
  governanceRefusals?: string[];
  lastAssistant?: AssistantMessage | undefined;
}

/** The `runFailed` meta of a run whose last reply is marked as a failed run (a budget or breaker stop): empty otherwise. */
export function runFailedMeta(attempt: GovernanceOutcome): { runFailed?: true } {
  return attempt.lastAssistant?.runFailed === true ? { runFailed: true } : {};
}

/** True when the attempt must not be auto-continued: a gate refused one of its calls, or it ended as a failed run. */
export function blocksAutoContinue(attempt: GovernanceOutcome): boolean {
  return (attempt.governanceRefusals?.length ?? 0) > 0 || attempt.lastAssistant?.runFailed === true;
}
