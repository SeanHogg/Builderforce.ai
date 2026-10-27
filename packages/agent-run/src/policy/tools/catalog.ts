/**
 * catalog — the ONE catalog strategy (PRD 35 §6.10): a role core set (≤ 20) plus
 * `tool_search`, with NO lever; the pinned, required and named-in-prompt tools stay
 * advertised; `find_symbol` wherever `repo.symbols` exists, cloud included.
 *
 * Ported from `costLoop/deferredTools.ts` (the role core sets and the `tool_search`
 * meta tool). The source's catalog was the cloud cost loop's `DeferredToolRole` registry;
 * here the catalog is the shared `@builderforce/agent-tools` registry the run already
 * holds, so the policy narrows schemas rather than re-deriving them. The core-set LISTS
 * are copied verbatim from `deferredTools.ts` — the pinned tests assert them exactly.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { Capability, ToolSchema } from "@builderforce/agent-tools";
import { TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL } from "@builderforce/agent-tools";
import { promptNamedTools } from "./searchHelpers.js";

/** The role the run acts under — `deferredTools.ts` `DeferredToolRole`. */
export type DeferredToolRole = "explore" | "code" | "verify" | "plan";

/** Core set every role holds, verbatim from `deferredTools.ts` `ALWAYS`. */
export const ALWAYS_CORE_TOOLS: readonly string[] = [
  "read_file", "search_code", "list_files", "edit_file", "run_checks", "run_command", "finish", "ask_human", "spawn_agent",
];

/** Role-specific additions, verbatim from `deferredTools.ts` `ROLE_CORE_TOOLS`. */
export const ROLE_CORE_TOOLS: Readonly<Record<DeferredToolRole, readonly string[]>> = {
  explore: ["repo_map", "memory_recall", "workspace_read", "web_search", "web_fetch"],
  code: ["repo_map", "write_file", "delete_file", "update_prd", "memory_recall", "memory_remember", "claim_resource", "release_resource", "workspace_note"],
  verify: ["memory_recall", "workspace_read"],
  plan: ["spawn_agents", "wait_agents", "message_agent", "update_prd", "memory_recall", "memory_remember", "workspace_note", "workspace_read"],
};

/** A run role → its core-set row (anything unknown codes). */
export function deferredToolRole(role: string | null | undefined): DeferredToolRole {
  return role === "explore" || role === "verify" || role === "plan" ? role : "code";
}

/** The core names for a role (always + role), deduped, at most 20. */
export function coreToolNames(role: string): string[] {
  return [...new Set([...ALWAYS_CORE_TOOLS, ...ROLE_CORE_TOOLS[deferredToolRole(role)]])].slice(0, 20);
}

/** True when the catalog holds a symbols capability (`repo.symbols`), cloud included. */
export function hasSymbolsCapability(caps: ReadonlySet<Capability>): boolean {
  return caps.has("repo.symbols");
}

/**
 * The ONE catalog: the role's core set, plus `tool_search` (NO lever), plus `find_symbol`
 * wherever `repo.symbols` backs it. The `pinned`, `required` and prompt-named tools are
 * added by the caller on top — they stay advertised no matter how the core set scores.
 *
 * Returns the schemas in the catalog's own order (stable advertised bytes), so the
 * vendor's cached prompt prefix does not churn between turns.
 */
export function selectCatalog(
  catalog: readonly ToolSchema[],
  role: string,
  caps: ReadonlySet<Capability>,
  opts: { pinned?: readonly string[]; required?: readonly string[]; prompt?: string } = {},
): ToolSchema[] {
  const byName = new Map<string, ToolSchema>();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }

  const core = new Set(coreToolNames(role));
  // find_symbol wherever repo.symbols exists, cloud included.
  if (hasSymbolsCapability(caps)) core.add("find_symbol");
  core.add(TOOL_SEARCH_TOOL);

  // Pinned / required / named-in-prompt stay advertised.
  for (const name of opts.pinned ?? []) core.add(name);
  for (const name of opts.required ?? []) core.add(name);
  for (const name of promptNamedTools(opts.prompt ?? "")) {
    if (byName.has(name)) core.add(name);
  }

  // Catalog order, then the tool_search schema if it is not in the catalog.
  const out: ToolSchema[] = [];
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && core.has(name)) {
      out.push(tool);
      core.delete(name);
    }
  }
  if (core.has(TOOL_SEARCH_TOOL)) {
    out.push(TOOL_SEARCH_SCHEMA as ToolSchema);
    core.delete(TOOL_SEARCH_TOOL);
  }
  return out;
}
