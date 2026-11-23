/**
 * policy/guards/readOnly.ts — D8: which tool calls only READ, so a turn's consecutive
 * reads may dispatch concurrently through the kernel's `isReadOnly` port.
 *
 * Read eligibility comes from the registry's side-effect metadata. Unclassified
 * calls and run-control operations dispatch in order.
 */

import { CONTROL_TOOL_NAMES, resolveToolAlias, toolSideEffect } from "@builderforce/agent-tools";

/** Registered reads can batch. Calls that control the loop or wait for it stay in order. */
export function isReadOnlyCloudTool(name: string): boolean {
  const canonical = resolveToolAlias(name);
  return toolSideEffect(canonical) === "read" && !CONTROL_TOOL_NAMES.includes(canonical) && canonical !== "wait_agents";
}
