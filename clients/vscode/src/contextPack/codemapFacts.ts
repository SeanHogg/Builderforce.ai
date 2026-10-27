/**
 * Which `codemap:<area>` facts belong in a context pack (PRD 35 E2): the maps for the
 * areas the focus files sit in AND the code paths those files name (a PRD names the
 * modules it changes). A map is the run-end consolidation of an earlier run
 * (`memoryCommit.ts`) — "open these first instead of searching" for that area.
 *
 * The area rules are the shared ones (`@seanhogg/builderforce-memory/working`), so the
 * editor and the run-context source pick maps the same way — a root-level file maps to
 * the root area a root-only run is filed under. A request that names no path reaches its
 * areas through `requestAreas.ts`.
 *
 * Pure.
 */

import { CONSOLIDATED_KEY_PREFIX, MAX_RECALLED_MAPS, areaOfPath, consolidatedFactsFor } from "@seanhogg/builderforce-memory/working";
import { extractFocusPaths } from "./focusPaths";

export const CODEMAP_PREFIX = CONSOLIDATED_KEY_PREFIX;
/** Facts a pack carries. */
export const MAX_PACK_FACTS = MAX_RECALLED_MAPS;
/** Directories named, at most — the area query is a search, not a listing. */
const MAX_AREAS = 24;

/**
 * The directories a pack is about: each focus file's own, then those of every
 * workspace-relative path the focus files' contents name. Relative only — an absolute
 * path in a document is somebody else's machine.
 */
export function areasNamed(focusPaths: readonly string[], focusContents: readonly string[]): string[] {
  const out: string[] = [];
  const add = (p: string): void => {
    if (/^[A-Za-z]:|^[\\/]/.test(p)) return;
    const d = areaOfPath(p);
    if (d && !out.includes(d) && out.length < MAX_AREAS) out.push(d);
  };
  for (const p of focusPaths) add(p);
  for (const text of focusContents) for (const p of extractFocusPaths(text, MAX_AREAS)) add(p);
  return out;
}

/** The `codemap:` facts whose area overlaps a named directory, most specific first, capped. */
export function codemapFactsFor<F extends { key: string; content: string }>(facts: readonly F[], areas: readonly string[], max: number = MAX_PACK_FACTS): F[] {
  return consolidatedFactsFor(facts, areas, max);
}
