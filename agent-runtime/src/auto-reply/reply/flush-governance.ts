/**
 * A memory flush runs the embedded runner like any other turn, so a tenant governance gate can stop it from writing its notes in two ways:
 *   - REFUSE the tool calls it makes: the run reports WHICH gates (the structured `policy.blocked` path, relayed on the run result's
 *     `meta.agentMeta.governanceRefusals`);
 *   - WITHHOLD the write tools altogether (an unscoped `block`, or an approval gate on a run nobody can approve, which refuses at once): the
 *     model never sees a tool to call, so nothing is refused and nothing is reported. `flushWithheldBy` asks the gates the run was held to.
 *
 * The flush is still recorded as done (`memoryFlushAt`, `memoryFlushCompactionCount`): a flush the gate keeps stopping would otherwise run
 * again on every turn. The warning is what tells an operator the notes were not written.
 */
import { isToolWithheld } from "@builderforce/agent-run";
import { gatesForRun } from "../../infra/host-policy-gates.js";
import { logWarn } from "../../logger.js";

/** The tools that write a memory note. The flush can write only if at least one of them is offered. */
const FLUSH_WRITE_TOOLS = ["write", "edit", "apply_patch"] as const;

/**
 * The gates that withhold EVERY tool the flush writes with, or [] when it still has one to write with. The gates are the flush's own: the
 * tenant's, with approval gates turned into refusals because nobody can approve during a flush.
 */
export async function flushWithheldBy(): Promise<string[]> {
  const gates = await gatesForRun({ unattended: true });
  const byTool = FLUSH_WRITE_TOOLS.map((tool) => gates.filter((g) => isToolWithheld([g], tool)).map((g) => g.id));
  return byTool.every((ids) => ids.length > 0) ? [...new Set(byTool.flat())] : [];
}

/** Warn, naming the gates, when any refused the flush's tool calls or withheld the tools it writes with. Returns whether any did. */
export function warnIfFlushStopped(params: { refusedBy: readonly string[] | undefined; withheldBy: readonly string[] }): boolean {
  const { refusedBy = [], withheldBy } = params;
  if (refusedBy.length === 0 && withheldBy.length === 0) {
    return false;
  }
  const why = [
    refusedBy.length > 0 ? `governance gate ${refusedBy.join(", ")} refused the flush's tool calls` : "",
    withheldBy.length > 0 ? `governance gate ${withheldBy.join(", ")} withholds the tools the flush writes with` : "",
  ].filter(Boolean);
  logWarn(
    `[memory-flush] ${why.join("; ")}, so its notes were not written; ` + "the flush is recorded as done so it is not re-run every turn",
  );
  return true;
}
