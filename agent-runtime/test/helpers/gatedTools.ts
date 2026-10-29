/**
 * Which tools survive a run's governance gates, asked of the LIVE seam (`isToolWithheld`,
 * the question the agent's tool catalog asks every turn). The vocabulary is the one a gate
 * is authored against: the names the deleted Claude Agent SDK runner passed as its
 * allowlist, which the gate tests were written in.
 */

import { isToolWithheld, offeredSchemas } from "@builderforce/agent-run";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";

export const GATED_TOOL_VOCABULARY = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"] as const;

/** The vocabulary (plus mounted tool entries) minus what the gates withhold. */
export function allowedToolsAfterGates(gates: readonly PolicyGate[] | undefined, extraTools: readonly string[] = []): string[] {
  return [...GATED_TOOL_VOCABULARY, ...extraTools].filter((tool) => !isToolWithheld(gates, tool));
}

/** The tools a surface granting `caps` is OFFERED under `gates`: the agent's live catalog, minus what a gate withholds. */
export function offeredTools(caps: readonly Capability[], gates?: readonly PolicyGate[]): string[] {
  return offeredSchemas({ capabilities: { capabilities: new Set(caps) } })
    .map((schema) => schema.function.name)
    .filter((name) => !isToolWithheld(gates, name));
}
