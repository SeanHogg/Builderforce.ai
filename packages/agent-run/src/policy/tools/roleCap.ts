/**
 * roleCap — the advertised-tool cap for a CODE or VERIFY turn on a surface that owns its
 * whole catalog (`PlatformTools.closed`: the VS Code / Brain run).
 *
 * Why it exists (chats #60338 / #61651): the Brain's selection advertised a fixed 64-tool
 * relevance set (`DEFAULT_TOOL_LIMIT`) to EVERY turn, plus the tools the run had already
 * called (appended beyond the cap) plus the three router tools (`builtin_tools_find` /
 * `_describe` / `_invoke`) whenever the catalog was trimmed — 66–69 tools of ~480 on most
 * turns. The catalog-order backfill fills those 64 slots with whatever comes first, so a
 * one-line code fix carried ticket, board and platform schemas it would never call, and
 * the prompt ran to 50–80k tokens a turn. The role core set (`catalog.ts`) was never
 * consulted, because a closed surface skips it.
 *
 * A capped role keeps:
 *   • its role tool set — the shared core names ({@link coreToolNames}) plus the
 *     navigation/inspection companions a host advertises under its own names
 *     ({@link ROLE_COMPANION_TOOLS}) — wherever the catalog holds them;
 *   • any other tool only when it MATCHES the turn's request (no catalog-order backfill),
 *     so platform/ticket tools reach a code turn only when the ask is about them;
 *   • the tools the run already called or loaded through the router (pinned, appended);
 *   • everything else stays reachable through the surface's router (`builtin_tools_find`).
 *
 * Pure; no `node:*`, no DOM.
 */

import { coreToolNames } from "./catalog.js";
import { DEFAULT_TOOL_LIMIT } from "./selectTools.js";

/** The roles whose turns are capped. Planning and chat keep the wide relevance set. */
export type CappedToolRole = "code" | "verify";

/** The most tools a capped role's fixed set advertises (pins and router tools ride on top). */
export const ROLE_TOOL_LIMIT: Readonly<Record<CappedToolRole, number>> = { code: 22, verify: 18 };

/**
 * The companions a role keeps beside the shared core names — the editor's names for symbol
 * navigation, background-command status, read-only git, project memory, the skill library and
 * asking the person. A name the catalog does not hold is simply absent.
 */
export const ROLE_COMPANION_TOOLS: Readonly<Record<CappedToolRole, readonly string[]>> = {
  code: [
    "find_symbol", "file_outline", "semantic_search", "command_status", "command_stop",
    "git_status", "git_diff", "recall_facts", "remember_fact", "ask_user", "builtin_skills_read",
  ],
  verify: [
    "find_symbol", "file_outline", "command_status", "command_stop",
    "git_status", "git_diff", "git_history", "recall_facts", "ask_user",
  ],
};

/** Whether a turn's role is capped. */
export function isCappedToolRole(role: string | null | undefined): role is CappedToolRole {
  return role === "code" || role === "verify";
}

/** The fixed-set limit for a role's turn: the role cap, or the wide default for every other role. */
export function roleToolLimit(role: string | null | undefined): number {
  return isCappedToolRole(role) ? ROLE_TOOL_LIMIT[role] : DEFAULT_TOOL_LIMIT;
}

/** A capped role's tool names, core first, deduped. */
export function roleToolNames(role: CappedToolRole): string[] {
  return [...new Set([...coreToolNames(role), ...ROLE_COMPANION_TOOLS[role]])];
}

/** What a capped role's selection asks of `selectToolsForTurn`. */
export interface RoleCappedSelection {
  limit: number;
  /** The role set the catalog holds, plus the surface's own role keep-set: held to the limit. */
  required: string[];
  /** Fill only with tools that match the request — never the catalog-order backfill. */
  backfill: false;
}

/**
 * The selection a capped role's turn makes over `catalogNames`. `keep` is the surface's own
 * vocabulary a role must not lose (e.g. a Studio's build tools); the surface's wider required set
 * (every workspace tool, every tool the persona names) is NOT carried — the router reaches those.
 */
export function roleCappedSelection(
  role: CappedToolRole,
  catalogNames: Iterable<string>,
  keep: Iterable<string> = [],
): RoleCappedSelection {
  const present = new Set(catalogNames);
  const required = [...new Set([...roleToolNames(role), ...keep])].filter((n) => present.has(n));
  // A keep-set larger than the cap widens it rather than dropping a tool the surface IS.
  return { limit: Math.max(ROLE_TOOL_LIMIT[role], required.length), required, backfill: false };
}
