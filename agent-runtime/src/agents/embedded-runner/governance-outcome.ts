/**
 * What a run learned about governance, read by the run loop:
 *   - the ids of the gates that refused a tool call (the structured `policy.blocked` path, relayed through the run's shared governance
 *     scope across EVERY attempt), so a caller can say which gate stopped a run (a memory flush that wrote nothing);
 *   - whether the run may be AUTO-CONTINUED. Continuing a run a gate refused, or one that ended failed (budget or breaker), re-runs the
 *     very calls that were refused, so neither is continued;
 *   - the `runFailed` meta of a run that ended as a failed run.
 */
import type { createRunGovernance } from "../../builderforce/agent-loop/run-governance.js";
import type { AssistantMessage } from "../../builderforce/model/types.js";

type Scope = ReturnType<typeof createRunGovernance>;

/** True when the attempt must not be auto-continued: a gate refused one of the run's calls, or it ended as a failed run. */
export function blocksAutoContinue(governance: Scope, attempt: { lastAssistant?: AssistantMessage | undefined }): boolean {
  return governance.refusals().length > 0 || attempt.lastAssistant?.runFailed === true;
}

/** The `runFailed` meta of a run whose last reply is marked as a failed run (a budget or breaker stop): empty otherwise. */
export function runFailedMeta(attempt: { lastAssistant?: AssistantMessage | undefined }): { runFailed?: true } {
  return attempt.lastAssistant?.runFailed === true ? { runFailed: true } : {};
}

/** The gates that refused the run's calls, for the result's agent meta: empty when none did. */
export function governanceMeta(governance: Scope): { governanceRefusals?: string[] } {
  const refusals = governance.refusals();
  return refusals.length > 0 ? { governanceRefusals: refusals } : {};
}
