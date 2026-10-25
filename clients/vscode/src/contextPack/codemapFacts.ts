/**
 * Which `codemap:<area>` facts belong in a context pack (PRD 35 E2): the maps for the
 * areas the focus files sit in AND the code paths those files name (a PRD names the
 * modules it changes). A map is the run-end consolidation of an earlier run
 * (`memoryCommit.ts`) — "open these first instead of searching" for that area.
 *
 * Pure.
 */

import { extractFocusPaths } from "./focusPaths";

export const CODEMAP_PREFIX = "codemap:";
/** Facts a pack carries. */
export const MAX_PACK_FACTS = 6;
/** Directories named, at most — the area query is a search, not a listing. */
const MAX_AREAS = 24;

function dirOf(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  const i = norm.lastIndexOf("/");
  // A path with no extension may itself be a directory ("clients/vscode/src").
  if (!/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(norm)) return norm.replace(/\/+$/, "");
  return i > 0 ? norm.slice(0, i) : "";
}

/**
 * The directories a pack is about: each focus file's own, then those of every
 * workspace-relative path the focus files' contents name. Relative only — an absolute
 * path in a document is somebody else's machine.
 */
export function areasNamed(focusPaths: readonly string[], focusContents: readonly string[]): string[] {
  const out: string[] = [];
  const add = (p: string): void => {
    if (/^[A-Za-z]:|^[\\/]/.test(p)) return;
    const d = dirOf(p);
    if (d && !out.includes(d) && out.length < MAX_AREAS) out.push(d);
  };
  for (const p of focusPaths) add(p);
  for (const text of focusContents) for (const p of extractFocusPaths(text, MAX_AREAS)) add(p);
  return out;
}

/** True when `area` and `dir` are the same directory or one contains the other. */
function overlaps(area: string, dir: string): boolean {
  return area === dir || dir.startsWith(`${area}/`) || area.startsWith(`${dir}/`);
}

/** The `codemap:` facts whose area overlaps a named directory, most specific first, capped. */
export function codemapFactsFor<F extends { key: string; content: string }>(facts: readonly F[], areas: readonly string[], max: number = MAX_PACK_FACTS): F[] {
  if (areas.length === 0) return [];
  const scored: Array<{ fact: F; depth: number }> = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!fact.key.startsWith(CODEMAP_PREFIX) || seen.has(fact.key)) continue;
    const area = fact.key.slice(CODEMAP_PREFIX.length);
    if (!areas.some((d) => overlaps(area, d))) continue;
    seen.add(fact.key);
    scored.push({ fact, depth: area.split("/").length });
  }
  return scored.sort((a, b) => b.depth - a.depth).slice(0, max).map((s) => s.fact);
}
