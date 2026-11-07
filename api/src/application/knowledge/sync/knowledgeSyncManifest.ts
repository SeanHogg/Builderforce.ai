/**
 * knowledgeSyncManifest — the server's half of delta-finding (PRD 41 A11 rule 2). The three questions a
 * client asks before it builds a pack, each answered from the server's own rows by the codec's shared
 * `manifestTree`, so both sides cut a root the same way:
 *
 *   manifest   GET  …/sync/manifest?root=     the root digest and the 4,096 bucket digests (BFKP `BKT`)
 *   leaves     POST …/sync/manifest           the leaves of the buckets asked for (BFKP `LEAF`)
 *   have       POST …/sync/have               which content hashes the project already holds (a bitmap)
 *
 * The frame's `baseGeneration` carries the server generation the answer was read at, so a client
 * can tell, when it sends its pack, whether the server moved in between (then the pack gets a 409).
 */
import {
  encodePack, manifestTree, rootLeaves, MANIFEST_BUCKETS, ZERO_DIGEST, type ManifestLeaf, type ManifestTree, type RootRows,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import type { KnowledgeStorePort } from '../knowledgePorts';
import { decodeGuarded } from './decodeGuarded';
import { KnowledgeSyncError, MAX_HAVE_HASHES, type KnowledgeSyncPort, type SyncState } from './knowledgeSyncPorts';

export interface ManifestDeps {
  store: Pick<KnowledgeStorePort, 'facts' | 'relations'>;
  sync: KnowledgeSyncPort;
}

/** The rows of the root as the server holds them. */
export async function serverRootRows(deps: ManifestDeps, rootId: string): Promise<RootRows> {
  const files = await deps.sync.sources(rootId);
  const paths = new Set(files.map((f) => f.path));
  const facts = await deps.store.facts(paths);
  const relations = await deps.store.relations(rootId, new Set(facts.map((f) => `fact:${f.key}`)));
  return { files, facts, relations };
}

export async function serverManifest(deps: ManifestDeps, rootId: string): Promise<{ state: SyncState; tree: ManifestTree }> {
  const [state, rows] = await Promise.all([deps.sync.state(rootId), serverRootRows(deps, rootId)]);
  return { state, tree: manifestTree(rootLeaves(rootId, rows)) };
}

/** GET manifest: the root digest (as `targetDigest`) and the bucket digests. */
export async function manifestSummary(deps: ManifestDeps, rootId: string): Promise<Uint8Array> {
  const { state, tree } = await serverManifest(deps, rootId);
  return encodePack({ rootId, baseGeneration: state.generation, targetDigest: tree.root, buckets: tree.buckets });
}

/** POST manifest: the leaves of the requested buckets. The request is a BFKP frame whose `hashes` are not used; bucket ids ride in `leaves` keys as `b:<id>`. */
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
  const held = await deps.sync.hasExtracted(hashes);
  const out = new Uint8Array(Math.ceil(hashes.length / 8));
  held.forEach((yes, i) => { if (yes) out[i >> 3]! |= 1 << (i & 7); });
  return out;
}

export { ZERO_DIGEST };
