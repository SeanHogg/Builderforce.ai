/**
 * platform — the catalog of a surface that declares its own tools the whole catalog
 * (`PlatformTools.closed`; today the Creation Canvas).
 *
 * The Creation Canvas advertises the board's tools (`canvas_*`, the tenant's MCP catalog,
 * the guest research and career packs) and nothing from the shared registry: the role core
 * set and `tool_search` are the cloud and editor's strategy for a repository, and a model
 * asked to build a poster must not be offered `run_command`. What the scope shares with
 * every other is the SELECTION — the lexical, synonym-expanded, pinned and required
 * ranking of `selectTools.ts` — so a 541-tool board advertises the same fixed, relevant
 * set a 541-tool editor does.
 *
 * The surface reports what it can run right now (`PlatformTools.schemas`, which a rung may
 * have withdrawn from), and the data the selection reads (`PlatformTools.selection`).
 * This module decides which of them the model is shown.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { PolicyContext } from "../hooks.js";
import { selectToolsForTurn } from "./selectTools.js";
import { isCappedToolRole, roleCappedSelection } from "./roleCap.js";

/** The platform tools this turn advertises, or nothing when the run has no platform port. */
export function selectPlatformCatalog(ctx: PolicyContext, pinned: readonly string[]): readonly ToolSchema[] | undefined {
  const platform = ctx.ports.platform;
  if (!platform?.closed) return undefined;
  const catalog = platform.schemas({ rungs: ctx.state.stall?.rungs ?? {} });
  const selection = platform.selection;
  const { query } = selection;
  // A code or verify turn is capped to the surface's required set (always kept), its role's tool set and what matches the request
  // (`roleCap.ts`); every other turn keeps the surface's own limit and required set.
  const capped = isCappedToolRole(selection.role)
    ? roleCappedSelection(selection.role, catalog.map((t) => t.function?.name ?? ""), selection.roleKeep ?? [], selection.required)
    : undefined;
  const limit = capped?.limit ?? selection.limit;
  const required = capped?.required ?? [...selection.required];
  // The surface knows what it ran: its own pins (a call through its router counts as the tool it reached; a compaction that dropped the
  // call keeps the pin; an earlier run pins nothing) replace the ones read off the transcript.
  return selectToolsForTurn(catalog, { query, limit, pinned: selection.pinned ? [...selection.pinned] : pinned, required, ...(selection.rank ? { rank: selection.rank } : {}), ...(selection.capRequired ? { capRequired: true } : {}), ...(capped ? { backfill: false } : {}) }).tools;
}
