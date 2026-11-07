/**
 * knowledgeSyncManifest — the server's half of delta-finding (PRD 41 A11 rules 2 and 4b). The three questions a
 * client asks before it builds a pack:
 *
 *   manifest   GET  …/sync/manifest?root=     the root digest and the 4,096 bucket digests (BFKP `BKT`)
 *   leaves     POST …/sync/manifest           the leaves of the buckets asked for (BFKP `LEAF`)
 *   have       POST …/sync/have               which content hashes the project already holds (a bitmap)
 *
 * The tree is built from `knowledge_sync_leaves` ONLY — the digests the client computed for the rows this root
 * synced, read in pages with no cap. It never reads `project_facts` or the relation table: those are shared by every
 * root of the project, a display cap would truncate them, and the fact writer normalises them, so a digest taken from
 * them would never converge with the client's.
 *
 * The frame's `baseGeneration` carries the generation the answer was read at, so a client can tell, when it sends
 * its pack, whether the server moved in between (then the pack gets a 409).
 */
import {
  encodePack, manifestTree, MANIFEST_BUCKETS, type ManifestLeaf, type ManifestTree,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';
import { decodeGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_HAVE_HASHES, type KnowledgeSyncPort, type SyncState } from './knowledgeSyncPorts';

export interface ManifestDeps {
  sync: KnowledgeSyncPort;
  ledger: KnowledgeLedgerPort;
}

/** The root's manifest tree, from its leaves. Pass a transaction's `ledger` to read inside it. */
export async function serverTree(deps: Pick<ManifestDeps, 'ledger'>, rootId: string, ledger?: KnowledgeLedgerPort): Promise<ManifestTree> {
  const leaves = await (ledger ?? deps.ledger).leaves.all(rootId);
  return manifestTree(leaves.map((l) => ({ key: l.key, digest: l.digest })));
}

export async function serverManifest(deps: ManifestDeps, rootId: string, ledger?: KnowledgeLedgerPort): Promise<{ state: SyncState; tree: ManifestTree }> {
  const [state, tree] = await Promise.all([deps.sync.state(rootId, ledger), serverTree(deps, rootId, ledger)]);
  return { state, tree };
}

/** GET manifest: the root digest (as `targetDigest`) and the bucket digests. */
export async function manifestSummary(deps: ManifestDeps, rootId: string): Promise<Uint8Array> {
  const { state, tree } = await serverManifest(deps, rootId);
  return encodePack({ rootId, baseGeneration: state.generation, targetDigest: tree.root, buckets: tree.buckets });
}

/** POST manifest: the leaves of the requested buckets. */
export async function manifestLeaves(deps: ManifestDeps, rootId: string, bucketIds: readonly number[]): Promise<Uint8Array> {
  for (const b of bucketIds) {
    if (!Number.isInteger(b) || b < 0 || b >= MANIFEST_BUCKETS) throw new KnowledgeSyncError(422, 'bad_pack', `bucket ${b} is out of range`);
  }
  const { state, tree } = await serverManifest(deps, rootId);
  const leaves: ManifestLeaf[] = [...new Set(bucketIds)].flatMap((b) => tree.leaves.get(b) ?? []);
  return encodePack({ rootId, baseGeneration: state.generation, targetDigest: tree.root, leaves });
}

/** The bucket ids a leaf request names: its `leaves` keys are `b:<id>` placeholders (digest unused). */
export async function bucketIdsOf(body: Uint8Array): Promise<{ rootId: string; buckets: number[] }> {
  const pack = await decodeGuarded(body);
  const buckets = (pack.leaves ?? []).map((l) => (l.key.startsWith('b:') ? Number(l.key.slice(2)) : NaN));
  return { rootId: pack.rootId, buckets };
}

/**
 * POST have: a BFKP frame whose `hashes` are the candidates. The answer is a bitmap over those hashes in
 * the codec's table order (sorted): bit i of byte i>>3 (least significant first) is 1 when the project holds hash i.
 */
export async function haveBitmap(deps: Pick<ManifestDeps, 'sync'>, body: Uint8Array): Promise<Uint8Array> {
  const pack = await decodeGuarded(body);
  const hashes = pack.hashes ?? [];
  if (hashes.length > MAX_HAVE_HASHES) throw new KnowledgeSyncError(413, 'too_many_hashes', `a have request names at most ${MAX_HAVE_HASHES} hashes`);
  // ONE index query for every hash asked about.
  const held = await deps.sync.heldBodies(hashes);
  const out = new Uint8Array(Math.ceil(hashes.length / 8));
  hashes.forEach((h, i) => { if (held.has(h)) out[i >> 3]! |= 1 << (i & 7); });
  return out;
}

