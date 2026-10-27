/**
 * projectFacts × code maps — the two places a `codemap:<area>` fact is NOT an ordinary
 * single-subject belief, and what the store does about each.
 *
 * A code map (`@seanhogg/builderforce-memory/working` `consolidate`) lists up to twelve
 * files. An ordinary fact asserts one thing about one place, so the store retires it by
 * its first anchor and hides it when any anchor changed. Both rules are wrong for a map:
 *
 *   - WRITE: a map's anchors are every file it lists, and a merge keeps the earlier
 *     run's files ({@link codemapWriteAnchors}), so the stored anchors are the union of
 *     the prior map's and this write's, limited to the files the merged map still lists.
 *     Retirement is by key only (the merge replaces in place); see `projectFactsWrite`.
 *   - RECALL: one changed file drops that file's line, not the map
 *     ({@link withCurrentAnchors}). The map is hidden only when no listed file is left.
 */
import { consolidatedArea, consolidatedFiles, withoutConsolidatedFiles } from '@seanhogg/builderforce-memory/working';
import {
  anchorsAreStale,
  normalizeFileAnchors,
  staleAnchorPaths,
  type FactFileAnchor,
  type FileContentHashReader,
  type ProjectFact,
} from './projectFactsStore';

/** True for a `codemap:<area>` key. */
export function isCodemapKey(key: string): boolean {
  return consolidatedArea(key) !== undefined;
}

/** Path identity as the store compares it: slashes normalised, case ignored. */
function pathKey(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}

/**
 * The anchors to store with a code map: this write's anchors first (a file this run
 * touched gets a fresh hash), then the prior map's for files this write did not name,
 * keeping only files the merged map still lists. A file the merge removed (deleted, or
 * pushed past the cap) loses its anchor with its line.
 */
export function codemapWriteAnchors(
  mergedContent: string,
  priorAnchors: unknown,
  nextAnchors: readonly FactFileAnchor[] | null | undefined,
): FactFileAnchor[] | null {
  const listed = new Set(consolidatedFiles(mergedContent).map(pathKey));
  const out: FactFileAnchor[] = [];
  const seen = new Set<string>();
  const fresh = normalizeFileAnchors(nextAnchors) ?? [];
  const earlier = normalizeFileAnchors(Array.isArray(priorAnchors) ? (priorAnchors as FactFileAnchor[]) : null) ?? [];
  for (const anchor of [...fresh, ...earlier]) {
    const k = pathKey(anchor.path);
    if (seen.has(k) || (listed.size > 0 && !listed.has(k))) continue;
    seen.add(k);
    out.push(anchor);
  }
  return out.length ? out : null;
}

/**
 * The fact as recall may serve it, judged against the files' CURRENT hashes: an ordinary
 * fact with a changed anchor is gone (`null`), as before; a code map loses the changed
 * files' lines and anchors and is gone only when none of its files is left.
 */
export async function withCurrentAnchors(fact: ProjectFact, readHash: FileContentHashReader): Promise<ProjectFact | null> {
  if (!isCodemapKey(fact.key)) return (await anchorsAreStale(fact.fileAnchors, readHash)) ? null : fact;
  const stale = await staleAnchorPaths(fact.fileAnchors, readHash);
  if (stale.length === 0) return fact;
  const content = withoutConsolidatedFiles(fact.content, stale);
  if (content == null) return null;
  const gone = new Set(stale.map(pathKey));
  const fileAnchors = (fact.fileAnchors ?? []).filter((a) => !gone.has(pathKey(a.path)));
  return {
    key: fact.key,
    content,
    ...(fact.expiresAt !== undefined ? { expiresAt: fact.expiresAt } : {}),
    ...(fileAnchors.length ? { fileAnchors } : {}),
  };
}
