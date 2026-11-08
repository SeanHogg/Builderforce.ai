/**
 * knowledgeBuckets — a root's manifest digests, kept incrementally (PRD 41 A11 rule 4b; NEW-M3).
 *
 * The root digest is `rootDigestOfBuckets` of the root's 4,096 stored bucket digests. A pack recomputes only the buckets
 * its keys fall in, by reading just those buckets' leaves, so a pack touching 10 files reads a few dozen leaf rows, not
 * the root's 100,000. The GET manifest reads the bucket table, never the leaves.
 *
 * A root written before the bucket table existed (leaves, no bucket rows) is filled ONCE, lazily, under the project's
 * sync lock: its leaves get their `bucket` and its bucket digests are computed from all of them.
 */
import { bucketDigest, bucketOf, manifestTree, rootDigestOfBuckets } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { KnowledgeLedgerPort } from './knowledgeLedger';

/** Fills the root's buckets if it has leaves but no bucket rows. The caller holds the project's sync lock. */
export async function ensureBuckets(ledger: KnowledgeLedgerPort, rootId: string): Promise<void> {
  if (await ledger.buckets.has(rootId) || !(await ledger.leaves.any(rootId))) return;
  await ledger.leaves.fillBuckets(rootId);
  const tree = manifestTree(await ledger.leaves.all(rootId));
  await ledger.buckets.put(rootId, [...tree.leaves.keys()].map((bucket) => ({ bucket, digest: tree.buckets[bucket]! })));
}

/** `ensureBuckets` for a read path: takes the lock (in its own transaction) only when there is something to fill. */
export async function ensureBucketsLocked(ledger: KnowledgeLedgerPort, rootId: string): Promise<void> {
  if (await ledger.buckets.has(rootId) || !(await ledger.leaves.any(rootId))) return;
  await ledger.exclusive((locked) => ensureBuckets(locked, rootId));
}

/**
 * Recomputes the buckets that `keys` fall in from their leaves, stores them, and returns the root digest. Call it after
 * the leaves of `keys` were upserted or removed, inside the same transaction.
 */
export async function recomputeBuckets(ledger: KnowledgeLedgerPort, rootId: string, keys: Iterable<string>): Promise<string> {
  const touched = [...new Set([...keys].map(bucketOf))];
  if (touched.length > 0) {
    const grouped = new Map<number, Array<{ key: string; digest: string }>>(touched.map((b) => [b, []]));
    for (const l of await ledger.leaves.inBuckets(rootId, touched)) grouped.get(bucketOf(l.key))?.push(l);
    await ledger.buckets.put(rootId, touched.map((bucket) => ({ bucket, digest: bucketDigest(grouped.get(bucket) ?? []) })));
  }
  return rootDigestOfBuckets(await ledger.buckets.digests(rootId));
}

type LeafRows = Parameters<KnowledgeLedgerPort['leaves']['upsert']>[1];

/**
 * The ONE way a root's leaves change: upsert `leaves`, recompute the buckets they (and `touched`, e.g. removed keys) fall in,
 * hand the new root digest to `verify` (it throws to refuse, rolling the transaction back), then advance the generation from
 * `base`. `generation` is null when another writer moved the root first: the caller throws, so buckets never change
 * without a generation bump. Call inside the project's sync transaction.
 */
export async function commitLeaves(
  ledger: KnowledgeLedgerPort, rootId: string,
  args: { leaves: LeafRows; touched?: Iterable<string>; base: number; verify?: (digest: string) => void },
): Promise<{ generation: number | null; digest: string }> {
  await ledger.leaves.upsert(rootId, args.leaves);
  const digest = await recomputeBuckets(ledger, rootId, [...args.leaves.map((l) => l.key), ...(args.touched ?? [])]);
  args.verify?.(digest);
  return { generation: await ledger.roots.advance(rootId, args.base, digest), digest };
}

/** The root digest from the stored bucket digests (a root with no leaves is the empty tree's digest). */
export async function storedRootDigest(ledger: KnowledgeLedgerPort, rootId: string): Promise<string> {
  return rootDigestOfBuckets(await ledger.buckets.digests(rootId));
}
