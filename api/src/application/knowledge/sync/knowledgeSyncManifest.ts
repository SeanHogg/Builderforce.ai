/**
 * knowledgeSyncManifest — the server's half of delta-finding (PRD 41 A11 rules 2 and 4b). The three questions a
 * client asks before it builds a pack:
 *
 *   manifest   GET  …/sync/manifest?root=     the root digest and the 4,096 bucket digests (BFKP `BKT`)
 *   leaves     POST …/sync/manifest           the leaves of the buckets asked for (BFKP `LEAF`)
 *   have       POST …/sync/have               which `(hash, sourceRef)` pairs the project already holds (a bitmap)
 *
 * The tree is built from `knowledge_sync_buckets` and `knowledge_sync_leaves` ONLY — the digests the client computed for
 * the rows this root synced. The GET reads the stored bucket digests (4,096 small rows), never the leaves; the leaf
 * request reads only the buckets asked for. Neither reads `project_facts` or the relation table: those are shared by
 * every root of the project, a display cap would truncate them, and the fact writer normalises them, so a digest taken
 * from them would never converge with the client's.
 *
 * The frame's `baseGeneration` carries the generation the answer was read at, so a client can tell, when it sends
 * its pack, whether the server moved in between (then the pack gets a 409).
 */
import { encodePack, MANIFEST_BUCKETS, rootDigestOfBuckets, type ManifestLeaf } from '@seanhogg/builderforce-memory/knowledge/pack';
import { ensureBucketsLocked } from '../knowledgeBuckets';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';
import { decodeGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_HAVE_HASHES, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { checkRootId, normalizeRootId } from './packValidation';

export interface ManifestDeps {
  sync: KnowledgeSyncPort;
  ledger: KnowledgeLedgerPort;
}

/** GET manifest: the root digest (as `targetDigest`) and the bucket digests. */
export async function manifestSummary(deps: ManifestDeps, rawRoot: string): Promise<Uint8Array> {
  const rootId = normalizeRootId(rawRoot);
  checkRootId(rootId);
  await ensureBucketsLocked(deps.ledger, rootId);
  const [state, buckets] = await Promise.all([deps.sync.state(rootId), deps.ledger.buckets.digests(rootId)]);
  return encodePack({ rootId, baseGeneration: state.generation, targetDigest: rootDigestOfBuckets(buckets), buckets });
}

/** POST manifest: the leaves of the requested buckets. */
export async function manifestLeaves(deps: ManifestDeps, rawRoot: string, bucketIds: readonly number[]): Promise<Uint8Array> {
  const rootId = normalizeRootId(rawRoot);
  checkRootId(rootId);
  for (const b of bucketIds) {
    if (!Number.isInteger(b) || b < 0 || b >= MANIFEST_BUCKETS) throw new KnowledgeSyncError(422, 'bad_pack', `bucket ${b} is out of range`);
  }
  await ensureBucketsLocked(deps.ledger, rootId);
  const [state, buckets, found] = await Promise.all([deps.sync.state(rootId), deps.ledger.buckets.digests(rootId), deps.ledger.leaves.inBuckets(rootId, bucketIds)]);
  const leaves: ManifestLeaf[] = found.map((l) => ({ key: l.key, digest: l.digest }));
  return encodePack({ rootId, baseGeneration: state.generation, targetDigest: rootDigestOfBuckets(buckets), leaves });
}

/** The bucket ids a leaf request names: its `leaves` keys are `b:<id>` placeholders (digest unused). */
export async function bucketIdsOf(body: Uint8Array): Promise<{ rootId: string; buckets: number[] }> {
  const pack = await decodeGuarded(body);
  const buckets = (pack.leaves ?? []).map((l) => (l.key.startsWith('b:') ? Number(l.key.slice(2)) : NaN));
  return { rootId: normalizeRootId(pack.rootId), buckets };
}

/**
 * POST have: a BFKP frame whose `stale` rows are the `(sourceRef, hash)` pairs asked about. The answer is a bitmap over
 * those rows in the codec's decoded order (sorted by `sourceRef`): bit i of byte i>>3 (least significant first) is 1 when
 * the stored body of that hash has an entry for that sourceRef — a hash held only under another root answers 0, so just
 * this root's entry is uploaded. ONE indexed query.
 */
export async function haveBitmap(deps: Pick<ManifestDeps, 'sync'>, body: Uint8Array): Promise<Uint8Array> {
  const pack = await decodeGuarded(body);
  const pairs = (pack.stale ?? []).map((s) => ({ hash: s.hash, sourceRef: s.sourceRef }));
  if (pairs.length > MAX_HAVE_HASHES) throw new KnowledgeSyncError(413, 'too_many_hashes', `a have request names at most ${MAX_HAVE_HASHES} pairs`);
  const held = await deps.sync.heldEntries(pairs);
  const out = new Uint8Array(Math.ceil(pairs.length / 8));
  pairs.forEach((_, i) => { if (held.has(i)) out[i >> 3]! |= 1 << (i & 7); });
  return out;
}
