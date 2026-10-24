import * as vscode from "vscode";
import { readRecentSessionNotes } from "./sessionNotes";
import { desktopRepoMapSection } from "./desktopContext";
import { hostCostLeverOn } from "./hostCostLevers";
import { symbolIndexGrounding } from "./workspaceSymbols";

/** Single source of truth for the current workspace grounding summary, shared by the
 *  chat panels and the native chat participant (so none holds its own copy). */
let groundingSummary: string | undefined;

export function setGroundingSummary(summary: string | undefined): void {
  groundingSummary = summary;
}

/**
 * The grounding a turn should actually see: the workspace MAP plus what recent runs in
 * this workspace DID (`.builderforce/memory/<date>.md`).
 *
 * The map alone is a static picture of the repo's shape, refreshed only on rescan. The
 * notes are what makes the knowledge loop a loop — a run grounds on the decisions and
 * files of the runs before it, so the surface gets better the more it is used, which is
 * the behaviour the on-prem runtime has always had and the editor did not.
 *
 * With Builderforce Desktop running, the reference-ranked repo map from its live index
 * joins them — the codebase's shape by what the code actually depends on, current to the
 * last save rather than the last rescan. The definition index joins them too, so a turn
 * sees `.builderforce/symbols.json` up front instead of only when it calls `find_symbol`.
 *
 * Async and best-effort: an unreadable (or absent) memory tree, desktop service or
 * symbol index degrades to what remains, never to a failed turn.
 */
export async function getGroundingWithHistory(root: string | undefined): Promise<string | undefined> {
  const [stable, history] = await Promise.all([getStableGrounding(root), recentActivitySection(root)]);
  const sections = [stable, history].filter((s): s is string => !!s);
  return sections.length ? sections.join("\n\n") : undefined;
}

/**
 * The workspace's SHAPE — map, live repo map, definition index — without the run notes.
 * What the panel builds its system prompt from: it changes only on a rescan, so the
 * prompt stays a stable, cacheable prefix across a chat's runs. The notes, which change
 * after every run, reach each run fresh through {@link recentActivitySection} instead.
 */
export async function getStableGrounding(root: string | undefined): Promise<string | undefined> {
  const map = groundingSummary;
  if (!root) return map;
  const [repoMap, symbols] = await Promise.all([
    desktopRepoMapSection(root, { adaptive: hostCostLeverOn("c4_adaptive_context") }),
    symbolIndexGrounding(root),
  ]);
  const sections = [map, repoMap, symbols].filter((s): s is string => !!s);
  return sections.length ? sections.join("\n\n") : undefined;
}

/**
 * What recent runs in this workspace DID (`.builderforce/memory/<date>.md`), read NOW —
 * so a run started in a panel opened an hour ago still sees the run that just finished.
 * Volatile by construction: the run host sends it through the per-run context seam,
 * never the cached system prefix. '' when there is nothing (or nothing readable).
 */
export async function recentActivitySection(root: string | undefined): Promise<string> {
  if (!root) return "";
  const notes = await readRecentSessionNotes(root);
  return notes ? `## Recent activity in this workspace\n${notes}` : "";
}
