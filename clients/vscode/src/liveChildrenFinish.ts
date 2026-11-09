/**
 * The run's LIVE-CHILDREN finish hold (`BrainRunRequest.liveChildren`, bound in `brainRunHost.ts`): what an owner run is
 * told when it tries to end - in prose or through `finish` - while sub-agents it started are still working.
 *
 * Without it the owner ended, and each report that came in afterwards woke it into a new run with no ask of its own
 * (chats #60338 and #61651: wake runs with an empty ask spent 16 and more model turns). Pure: the host passes the owner's
 * live children (`ChildRuns.liveOf`).
 */

import { SUBAGENT_CONTROL_TOOL_NAMES } from "@builderforce/agent-tools";

/** The block reason, or null when no child of this owner is live. */
export function liveChildrenBlock(live: ReadonlyArray<{ handle: string }>): string | null {
  if (live.length === 0) return null;
  const handles = live.map((child) => child.handle).join(", ");
  const { wait, stop } = SUBAGENT_CONTROL_TOOL_NAMES;
  return (
    `Do not finish yet: ${live.length} sub-agent${live.length === 1 ? " you started is" : "s you started are"} still working (${handles}). `
    + `Call ${wait} for their reports, or ${stop} for any you no longer need, then finish with what they found.`
  );
}
