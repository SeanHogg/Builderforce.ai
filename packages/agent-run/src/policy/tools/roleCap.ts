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
 *   • the surface's REQUIRED set, always — every tool the prompt or the turn block names,
 *     the host's workspace vocabulary (`localToolsIn`), `hand_off`. Dropping a tool the
 *     prompt tells the model to call is what cost a 78-call / 44-minute run
 *     (`brain-embedded/src/runStore/runPreamble.ts`), so the cap never narrows it;
 *   • its role tool set — the shared core names ({@link coreToolNames}), the
 *     navigation/inspection companions a host advertises under its own names
 *     ({@link ROLE_COMPANION_TOOLS}) and the delivery/coordination tools every code and
 *     verify turn needs ({@link ROLE_GUARANTEED_TOOLS}) — wherever the catalog holds them;
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

/**
 * The tools a code or verify turn may never lose (where the catalog holds them): shipping the
 * change (commit, push, pull request), reading a retained command output, coordinating
 * sub-agents, reporting state and handing off, recording a review and updating the ticket.
 */
export const ROLE_GUARANTEED_TOOLS: readonly string[] = [
  "git_commit", "git_push", "open_pull_request", "output_filter", "wait_agents", "stop_agent", "message_agent",
  "update_task_state", "hand_off", "builtin_reviews_record", "builtin_tasks_update",
];

/** Room a capped role keeps for tools that MATCH the request, on top of its required set. */
export const ROLE_MATCH_ROOM: Readonly<Record<CappedToolRole, number>> = { code: 6, verify: 4 };

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
  return [...new Set([...coreToolNames(role), ...ROLE_COMPANION_TOOLS[role], ...ROLE_GUARANTEED_TOOLS])];
}

/** What a capped role's selection asks of `selectToolsForTurn`. */
export interface RoleCappedSelection {
  limit: number;
  /** The surface's required set, the role set and the surface's role keep-set the catalog holds — never dropped. */
  required: string[];
  /** Fill only with tools that match the request — never the catalog-order backfill. */
  backfill: false;
}

/**
 * The selection a capped role's turn makes over `catalogNames`. `surfaceRequired` is the surface's
 * required set (the tools the prompt names, its workspace vocabulary, `hand_off`) and `keep` its
 * own vocabulary a role must not lose (e.g. a Studio's build tools): both always survive. The cap
 * removes only the catalog-order backfill and the tools that neither the role nor the request needs.
 */
export function roleCappedSelection(
  role: CappedToolRole,
  catalogNames: Iterable<string>,
  keep: Iterable<string> = [],
  surfaceRequired: Iterable<string> = [],
): RoleCappedSelection {
  const present = new Set(catalogNames);
  const required = [...new Set([...surfaceRequired, ...roleToolNames(role), ...keep])].filter((n) => present.has(n));
  // A required set larger than the cap widens it rather than dropping a tool the prompt names; the
  // match room leaves the request's own tools a slot beside it.
  return { limit: Math.max(ROLE_TOOL_LIMIT[role], required.length + ROLE_MATCH_ROOM[role]), required, backfill: false };
}
