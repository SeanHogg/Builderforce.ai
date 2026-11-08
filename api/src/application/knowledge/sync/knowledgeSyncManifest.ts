/**
 * knowledgeSyncManifest — the server's half of delta-finding (PRD 41 A11 rules 2 and 4b). The three questions a
 * client asks before it builds a pack:
 *
 *   manifest   GET  …/sync/manifest?root=     the root digest and the 4,096 bucket digests (BFKP `BKT`)
 *   generation GET  …/sync/manifest?root=&view=generation   `{ generation, digest }` from the roots row alone (a quiet root's cheap probe)
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
import { KnowledgeSyncError, MAX_HAVE_HASHES, SYNC_LOCK_RETRY_SECONDS, type KnowledgeSyncPort } from './knowledgeSyncPorts';
import { checkHavePairs, checkRootId, normalizeRootId } from './packValidation';

export interface ManifestDeps {
  sync: KnowledgeSyncPort;
  ledger: KnowledgeLedgerPort;
}

const READ_ATTEMPTS = 3;

/**
 * Reads the generation and the rows it describes as ONE consistent answer, without a transaction: a pack advances the
 * generation in the same transaction that rewrites leaves and buckets, so if the generation is the same before and after
 * `read`, no pack committed in between and every row read belongs to that generation. A pack that did commit makes the
 * generation differ and the read is repeated (a manifest is a few indexed reads; a pack lands about once a minute). A
 * client that still got a mixed answer would send a pack at the wrong generation and take a 409, which reconciles: the
 * check only saves that round trip.
 */
async function readAtGeneration<T>(deps: ManifestDeps, rootId: string, read: () => Promise<T>): Promise<{ generation: number; value: T }> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    const before = await deps.sync.state(rootId);
    const value = await read();
    const after = await deps.sync.state(rootId);
    if (after.generation === before.generation) return { generation: before.generation, value };
  }
  throw new KnowledgeSyncError(503, 'sync_busy', 'the root is changing faster than it can be read; retry shortly', { retryAfterSeconds: SYNC_LOCK_RETRY_SECONDS });
}

/** GET manifest: the root digest (as `targetDigest`) and the bucket digests. */
export async function manifestSummary(deps: ManifestDeps, rawRoot: string): Promise<Uint8Array> {
  const rootId = normalizeRootId(rawRoot);
  checkRootId(rootId);
  await ensureBucketsLocked(deps.ledger, rootId);
  const { generation, value: buckets } = await readAtGeneration(deps, rootId, () => deps.ledger.buckets.digests(rootId));
  return encodePack({ rootId, baseGeneration: generation, targetDigest: rootDigestOfBuckets(buckets), buckets });
}

/**
 * GET manifest, `view=generation`: the root's acknowledged `{ generation, digest }` from its roots row ONLY — no bucket rows, no
 * lock, no body to speak of. A client that has nothing to send asks this to learn whether the server moved (a heal advances the
 * generation); only when it did does it read the full manifest.
 */
export async function manifestGeneration(deps: Pick<ManifestDeps, 'sync'>, rawRoot: string): Promise<{ generation: number; digest: string }> {
  const rootId = normalizeRootId(rawRoot);
  checkRootId(rootId);
  const { generation, digest } = await deps.sync.state(rootId);
  return { generation, digest };
}

/** POST manifest: the leaves of the requested buckets. */
export async function manifestLeaves(deps: ManifestDeps, rawRoot: string, bucketIds: readonly number[]): Promise<Uint8Array> {
  const rootId = normalizeRootId(rawRoot);
  checkRootId(rootId);
  for (const b of bucketIds) {
    if (!Number.isInteger(b) || b < 0 || b >= MANIFEST_BUCKETS) throw new KnowledgeSyncError(422, 'bad_pack', `bucket ${b} is out of range`);
  }
  await ensureBucketsLocked(deps.ledger, rootId);
  const { generation, value } = await readAtGeneration(deps, rootId, async () => {
    const [buckets, found] = await Promise.all([deps.ledger.buckets.digests(rootId), deps.ledger.leaves.inBuckets(rootId, bucketIds)]);
    return { buckets, found };
  });
  const leaves: ManifestLeaf[] = value.found.map((l) => ({ key: l.key, digest: l.digest }));
  return encodePack({ rootId, baseGeneration: generation, targetDigest: rootDigestOfBuckets(value.buckets), leaves });
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
 * the stored body of that hash has a real ENTRY for that sourceRef (a source declared entry-less never answers 1, so a body that
 * is only "not extracted yet" is still asked for) — a hash held only under another root answers 0, so just
 * this root's entry is uploaded. ONE indexed query.
 */
export async function haveBitmap(deps: Pick<ManifestDeps, 'sync'>, body: Uint8Array): Promise<Uint8Array> {
  const pack = await decodeGuarded(body);
  const pairs = (pack.stale ?? []).map((s) => ({ hash: s.hash, sourceRef: s.sourceRef }));
  if (pairs.length > MAX_HAVE_HASHES) throw new KnowledgeSyncError(413, 'too_many_hashes', `a have request names at most ${MAX_HAVE_HASHES} pairs`);
  // The pairs ride into one jsonb parameter: a NUL, a control character or a lone surrogate is a 422 here, never a 500 there.
  checkHavePairs(pairs);
  const held = await deps.sync.heldEntries(pairs);
  const out = new Uint8Array(Math.ceil(pairs.length / 8));
  pairs.forEach((_, i) => { if (held.has(i)) out[i >> 3]! |= 1 << (i & 7); });
  return out;
}
