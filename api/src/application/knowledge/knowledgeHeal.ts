/**
 * knowledgeHeal — what a HEALED body owes the roots that shared it (PRD 41 A11).
 *
 * A hash's index row names every source whose entry its body holds. When that body cannot be read (a lost R2 object) and an
 * arrival re-supplies the hash, the row is rewritten naming only the arriving sources (`mergeBody` of an unreadable body).
 * Every OTHER source the old row named has now lost its server body, but its root's manifest still says it is in sync: the
 * reconcile compares manifest LEAVES, never bodies, so a quiet root would never send it again.
 *
 * So the heal invalidates those roots' file leaves, with the machinery reconcile already honours and no new table:
 *   - the file's leaf keeps its key but takes {@link HEALED_LEAF_DIGEST} (no file hash can equal it), only while the leaf
 *     still names the lost hash (a path that moved on to another hash is left alone);
 *   - the touched buckets are recomputed and the root's generation advances with the new digest.
 * The root's next sync (a delta at its old ack gets 409 `generation_mismatch`; a root with no ack reconciles anyway) sees
 * a root digest and a bucket that differ, fetches that bucket's leaves, and `leafDelta` lists exactly those files as
 * differing; the pack builder then asks `have`, the index answers "not held", and the body is sent again. Nothing else is.
 *
 * Runs inside the pack's (or the legacy upload's) transaction, under the project's sync lock, after the index row is written.
 * The root being applied is left alone: its own pack asserts its digest, and it is re-sending what it names.
 */
import { bucketOf, fileLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { ensureBuckets, recomputeBuckets } from './knowledgeBuckets';
import { ENTRYLESS_PREFIX, type ExtractedLoc, type KnowledgeLedgerPort } from './knowledgeLedger';
import { pathOfSourceRef, rootOfRef } from './knowledgeRefs';

/** The digest a healed file leaf carries until its root sends the body again (a file digest is its content hash, never this). */
export const HEALED_LEAF_DIGEST = 'healed:body-lost';

/** One hash whose stored body was lost, and the source refs its old index row named that the rewritten row no longer does. */
export interface LostBody { hash: string; refs: string[] }

/** The sources `loc` (the old index row) named that `kept` (the rewritten body) does not, as `src:` refs. */
export function lostRefsOf(
  loc: Pick<ExtractedLoc, 'sourceRefs'>, kept: { entries: readonly Pick<Extracted, 'sourceRef'>[]; entryless: readonly string[] },
): string[] {
  const keep = new Set<string>([...kept.entries.map((e) => e.sourceRef), ...kept.entryless]);
  const named = loc.sourceRefs.map((r) => (r.startsWith(ENTRYLESS_PREFIX) ? r.slice(ENTRYLESS_PREFIX.length) : r));
  return [...new Set(named)].filter((r) => !keep.has(r));
}

/**
 * Makes every root (but `exceptRoot`) that named a lost body send it again on its next sync. The caller holds the project's
 * sync lock. Returns the roots invalidated.
 */
export async function invalidateLostBodies(ledger: KnowledgeLedgerPort, lost: readonly LostBody[], exceptRoot?: string): Promise<string[]> {
  const byRoot = new Map<string, Map<string, string>>(); // root → file leaf key → the lost hash it names
  for (const { hash, refs } of lost) {
    for (const ref of refs) {
      const root = rootOfRef(ref);
      if (!root || root === exceptRoot) continue;
      const wanted = byRoot.get(root) ?? new Map<string, string>();
      wanted.set(fileLeafKey(pathOfSourceRef(ref), hash), hash);
      byRoot.set(root, wanted);
    }
  }
  const invalidated: string[] = [];
  for (const [root, wanted] of byRoot) {
    await ensureBuckets(ledger, root);
    const present = await ledger.leaves.inBuckets(root, [...new Set([...wanted.keys()].map(bucketOf))]);
    const stale = present.filter((l) => wanted.get(l.key) === l.digest);
    if (stale.length === 0) continue;
    await ledger.leaves.upsert(root, stale.map((l) => ({ key: l.key, digest: HEALED_LEAF_DIGEST })));
    const digest = await recomputeBuckets(ledger, root, stale.map((l) => l.key));
    const row = await ledger.roots.get(root);
    if (row) await ledger.roots.advance(root, row.generation, digest);
    invalidated.push(root);
  }
  return invalidated;
}
