/**
 * Catalog completeness helpers for the tool side-effect classification.
 *
 * The classifier itself ({@link TOOL_SIDE_EFFECT}, `toolSideEffect`, `isMutatingTool`,
 * `isVerifyTool`) lives in the dependency-free `tool-side-effect.ts` so policy gates
 * and every host can import it without pulling the tool catalogs; it is re-exported
 * here. This file adds what needs the catalogs: the registered-tool list and the
 * unclassified / stale checks the completeness test walks.
 *
 * Capability gating (`requires`) is orthogonal: a surface may be unable to OFFER a
 * tool and still that tool is mutating. This is the ONE classifier — a second copy
 * fails `scripts/check-single-tool-classifier.mjs`. Agent-runtime's on-prem name
 * helper delegates to it for catalog names and fails closed for the rest.
 */

import type { ToolDefinition } from "./tool.js";
import { CORE_TOOLS } from "./core-tools.js";
import { SKILL_TOOLS } from "./skill-tools.js";
import { SUBAGENT_TOOLS } from "./subagent-tools.js";
import { TOOL_SIDE_EFFECT, toolSideEffect } from "./tool-side-effect.js";

export {
  TOOL_SIDE_EFFECT,
  toolSideEffect,
  isMutatingTool,
  isVerifyTool,
} from "./tool-side-effect.js";
export type { ToolSideEffect, ClassifiedToolName } from "./tool-side-effect.js";

/**
 * Every tool this package registers — core catalog plus the skill and sub-agent
 * catalogs that a surface opts into by capability. ONE list the completeness
 * test walks, so a new `defineTool` that is spliced into a catalog and not
 * classified is a red CI run rather than a comment.
 *
 * `SUBAGENT_TOOLS` already includes the live control verbs; do not concatenate
 * `SUBAGENT_CONTROL_TOOLS` again or the unique-name pin would fire.
 */
export const REGISTERED_TOOLS: readonly ToolDefinition[] = [
  ...CORE_TOOLS,
  ...SKILL_TOOLS,
  ...SUBAGENT_TOOLS,
];

/** Names in `tools` that have no {@link TOOL_SIDE_EFFECT} entry. */
export function unclassifiedTools(tools: readonly ToolDefinition[]): string[] {
  return tools.map((t) => t.name).filter((n) => toolSideEffect(n) == null);
}

/** Map keys that no longer name a registered tool. */
export function staleClassifications(tools: readonly ToolDefinition[]): string[] {
  const names = new Set(tools.map((t) => t.name));
  return Object.keys(TOOL_SIDE_EFFECT).filter((n) => !names.has(n));
}
