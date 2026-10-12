/**
 * Mutating vs read-only classification for EVERY tool this package registers.
 *
 * Capability gating (`requires`) is orthogonal: a surface may be unable to OFFER a
 * tool and still that tool is mutating. Policy gates (`evaluatePolicyGate`) match by
 * tool name (and optional path); they need to know which catalog entries write.
 * This table is the one answer. An unclassified name is treated as mutating at
 * runtime (fail closed) and fails {@link ./tool-mutation.test.ts} (CI).
 *
 * Do not copy this into a second engine. Agent-runtime's name-heuristic helper is
 * for on-prem payload fingerprinting of a different catalog; it is not this list.
 */

import type { ToolDefinition } from "./tool.js";
import { CORE_TOOLS } from "./core-tools.js";
import { SKILL_TOOLS } from "./skill-tools.js";
import { SUBAGENT_TOOLS } from "./subagent-tools.js";

/**
 * Side effect of one catalog tool.
 * - `read` — no durable write.
 * - `verify` — in-run check (static-check / typecheck / test). Does not write the
 *   repo. Distinct from `read` so policy can require a verify without treating it
 *   as a mutation, and distinct from `mutate` so a shell-less surface cannot be
 *   told that `run_checks` wrote anything.
 * - `mutate` — writes the working tree, memory, coordination, or a child run.
 *
 * `run_command` stays `mutate`: a shell can delete as easily as it can `npm test`.
 * Container/on-prem in-run verify *uses* `run_command` to exec the planned
 * package scripts; that does not reclassify the tool.
 */
export type ToolSideEffect = "read" | "verify" | "mutate";

/**
 * Exhaustive map: every name in {@link REGISTERED_TOOLS} has an entry, and every
 * entry names a registered tool. Adding a tool without classifying it fails CI.
 */
export const TOOL_SIDE_EFFECT = {
  // ── CORE_TOOLS (includes symbols, semantic, git) ──────────────────────────
  list_files: "read",
  search_code: "read",
  read_file: "read",
  find_symbol: "read",
  file_outline: "read",
  semantic_search: "read",
  repo_map: "read",
  write_file: "mutate",
  edit_file: "mutate",
  delete_file: "mutate",
  run_checks: "verify",
  run_command: "mutate",
  git_status: "read",
  git_diff: "read",
  git_history: "read",
  git_sync_latest: "mutate",
  git_undo: "mutate",
  git_redo: "mutate",
  git_commit: "mutate",
  git_push: "mutate",
  open_pull_request: "mutate",
  git_cleanup_merged: "mutate",
  web_fetch: "read",
  web_search: "read",
  memory_recall: "read",
  memory_remember: "mutate",
  memory_forget: "mutate",
  claim_resource: "mutate",
  release_resource: "mutate",
  workspace_note: "mutate",
  workspace_read: "read",
  ask_human: "read",
  update_prd: "mutate",
  finish: "read",
  // ── SKILL_TOOLS ───────────────────────────────────────────────────────────
  skill_propose: "mutate",
  skill_list: "read",
  // ── SUBAGENT_TOOLS (includes live control verbs) ──────────────────────────
  spawn_agent: "mutate",
  spawn_agents: "mutate",
  wait_agents: "read",
  message_agent: "mutate",
  stop_agent: "mutate",
} as const satisfies Record<string, ToolSideEffect>;

export type ClassifiedToolName = keyof typeof TOOL_SIDE_EFFECT;

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

export function toolSideEffect(name: string): ToolSideEffect | undefined {
  return TOOL_SIDE_EFFECT[name as ClassifiedToolName];
}

/**
 * True when `name` writes. Unclassified names fail closed (mutating) so a new
 * tool is gated until someone classifies it; the completeness test is what
 * makes that a CI failure rather than a silent production surprise.
 * `verify` is not a write.
 */
export function isMutatingTool(name: string): boolean {
  const effect = toolSideEffect(name);
  return effect == null || effect === "mutate";
}

/** True when `name` is an in-run check (static-check / typecheck / test). */
export function isVerifyTool(name: string): boolean {
  return toolSideEffect(name) === "verify";
}

/** Names in `tools` that have no {@link TOOL_SIDE_EFFECT} entry. */
export function unclassifiedTools(tools: readonly ToolDefinition[]): string[] {
  return tools.map((t) => t.name).filter((n) => toolSideEffect(n) == null);
}

/** Map keys that no longer name a registered tool. */
export function staleClassifications(tools: readonly ToolDefinition[]): string[] {
  const names = new Set(tools.map((t) => t.name));
  return Object.keys(TOOL_SIDE_EFFECT).filter((n) => !names.has(n));
}
