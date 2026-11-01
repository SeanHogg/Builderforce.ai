/**
 * A memory flush runs the embedded runner like any other turn, so a tenant governance gate can refuse the tool calls that write its
 * notes. The run reports WHICH gates refused (the structured `policy.blocked` path, relayed on the run result's
 * `meta.agentMeta.governanceRefusals`), and this is what the flush says about it.
 *
 * The flush is still recorded as done (`memoryFlushAt`, `memoryFlushCompactionCount`): a flush the gate keeps refusing would
 * otherwise run again on every turn, and the refusal would repeat. The warning is what tells an operator the notes were not written.
 */
import { logWarn } from "../../logger.js";

/** Warn, naming the gates, when any refused the flush's tool calls. Returns whether any did. */
export function warnIfFlushRefused(gateIds: readonly string[] | undefined): boolean {
  if (!gateIds || gateIds.length === 0) {
    return false;
  }
  logWarn(
    `[memory-flush] governance gate ${gateIds.join(", ")} refused the flush's tool calls, so its notes may not have been written; ` +
      "the flush is recorded as done so it is not re-run every turn",
  );
  return true;
}
