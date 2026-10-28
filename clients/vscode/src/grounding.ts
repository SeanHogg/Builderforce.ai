import { readRecentSessionNotes } from "./sessionNotes";
import { desktopRepoMapSection } from "./desktopContext";
import { hostCostLeverOn } from "./hostCostLevers";
import { symbolIndexGrounding } from "./workspaceSymbols";
import { withinMs } from "./contextPack/withinMs";

/** Single source of truth for the current workspace grounding summary, shared by the
 *  chat panels and the native chat participant (so none holds its own copy). */
let groundingSummary: string | undefined;

/** The stable grounding, computed once per workspace root and kept until a rescan or an
 *  explicit refresh ({@link invalidateStableGrounding}). */
let stableGrounding: { root: string; value: Promise<string | undefined> } | undefined;

/** A rescan's result (or a cleared workspace): the next turn recomputes the stable grounding. */
export function setGroundingSummary(summary: string | undefined): void {
  groundingSummary = summary;
  stableGrounding = undefined;
}

/** Drop the memoised stable grounding — the explicit refresh (a rescan already does it). */
export function invalidateStableGrounding(): void {
  stableGrounding = undefined;
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
 * joins them — the codebase's shape by what the code actually depends on, as of the last
 * rescan (it is part of the memoised stable grounding). The definition index joins them too, so a turn
 * sees `.builderforce/symbols.json` up front instead of only when it calls `find_symbol`.
 *
 * Async and best-effort: an unreadable (or absent) memory tree, desktop service or
 * symbol index degrades to what remains, never to a failed turn.
 */
export async function getGroundingWithHistory(root: string | undefined): Promise<string | undefined> {
  const [stable, history] = await Promise.all([stableGroundingWithin(root, RUN_GROUNDING_BUDGET_MS), recentActivitySection(root)]);
  const sections = [stable, history].filter((s): s is string => !!s);
  return sections.length ? sections.join("\n\n") : undefined;
}

/**
 * The workspace's SHAPE — map, live repo map, definition index — without the run notes.
 * What the panel builds its system prompt from: it changes only on a rescan, so the
 * prompt stays a stable, cacheable prefix across a chat's runs. The notes, which change
 * after every run, reach each run fresh through {@link recentActivitySection} instead.
 *
 * Computed ONCE per workspace root and memoised until the next rescan
 * ({@link setGroundingSummary}) or an explicit {@link invalidateStableGrounding}. Built
 * per call, the live Desktop map and the symbol index (which the file watcher updates on
 * every save) changed the system prompt between runs, so its cached prefix missed.
 */
export function getStableGrounding(root: string | undefined): Promise<string | undefined> {
  if (!root) return Promise.resolve(groundingSummary);
  if (stableGrounding?.root !== root) {
    const value = buildStableGrounding(root, groundingSummary);
    stableGrounding = { root, value };
    // A failed build is never served again: the next turn retries.
    value.catch(() => {
      if (stableGrounding?.value === value) stableGrounding = undefined;
    });
  }
  return stableGrounding.value;
}

/** How long the panel's `init` waits for the grounding before it posts without the index. */
export const INIT_GROUNDING_BUDGET_MS = 1_500;
/** How long a run's start (panel run or chat participant) waits for the grounding. */
export const RUN_GROUNDING_BUDGET_MS = 3_000;

/**
 * {@link getStableGrounding}, waited on for at most `ms`. A cold definition index (a new
 * workspace, or a snapshot written by another extractor) is a whole-workspace parse that
 * can take minutes; nothing that renders or starts a run waits on it. Late, the build
 * carries on and `onLate` fires once it lands, so the caller can re-read the now-memoised
 * value. What a late caller gets meanwhile is `late`: the rescan's map alone (`"map"`, the
 * default), or `undefined` (`"nothing"`) for a caller that already holds a fuller map and
 * keeps it when handed nothing (the run port: `replaceWorkspaceMap(prompt, undefined)`).
 */
export async function stableGroundingWithin(
  root: string | undefined,
  ms: number,
  opts: { onLate?: () => void; late?: "map" | "nothing" } = {},
): Promise<string | undefined> {
  const { onLate } = opts;
  const work = getStableGrounding(root);
  let settled = false;
  // Registered before the race, so a build that beats the deadline is marked settled first.
  const built = work.then(() => { settled = true; return true; }, () => { settled = true; return false; });
  const value = await withinMs(work, ms, opts.late === "nothing" ? undefined : groundingSummary);
  // Only a build that LANDED re-pushes: a failed one is cleared from the memo, and
  // re-reading it would start the slow build again.
  if (!settled && onLate) void built.then((ok) => { if (ok) onLate(); });
  return value;
}

async function buildStableGrounding(root: string, map: string | undefined): Promise<string | undefined> {
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
