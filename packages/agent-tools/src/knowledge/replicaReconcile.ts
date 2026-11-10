/**
 * knowledge/replicaReconcile.ts — the RECONCILE path of a sync (PRD 41 A11 rules 2 and 4b): finding the delta
 * with the manifest tree when there is no ack, the server's generation moved, the dirty set was lost
 * or a 409 came back.
 *
 * Both sides compute the same `manifestTree` over the root's LEAVES (files, facts, relations): the client from its
 * local store, the server from the leaves this root synced (never from the project's shared tables). The client
 * reads the server's root digest and 4,096 bucket digests (one GET, at most 128 KB), asks only for the leaves of the
 * buckets that differ, and the touched keys are exactly the leaves the server lacks or holds with another digest.
 * Equal root digests, or nothing left to send, mean nothing is sent. A full pack is planned only when the server holds
 * nothing for the root.
 *
 * A DELETION ONLY EVER COMES FROM EXPLICIT LOCAL EVIDENCE: a key in the dirty set (a file this machine's review saw
 * removed, a row deleted here). A leaf the server holds that this store merely lacks belongs to another host sharing the
 * root (or to a review that ran before this store existed); it is never tombstoned, however complete this store's own
 * review of the root. So two machines that both fully reviewed a root never delete each other's leaves.
 *
 * Rows that are not leaves (a person's note, an agent's fact) never make the trees differ; those among the dirty
 * keys are kept, so they still reach the project through their own writer.
 */

import type { KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import { differingBuckets, leafDelta, manifestTree, rootLeaves } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { ReplicaSource } from './replicaPack.js';
import { sourcePathIn } from './rootId.js';
import { factKey, relationKey, type ReplicaAck } from './replicaQueue.js';

export interface ReconcileQueries {
    syncManifest(rootId: string): Promise<{ generation: number; digest: string; buckets: string[] }>;
    syncLeaves(rootId: string, bucketIds: readonly number[]): Promise<{ generation: number; leaves: Array<{ key: string; digest: string }> }>;
}

export type ReconcilePlan =
    /** Nothing differs: the dirty set is satisfied. */
    | { kind: 'equal'; ack: ReplicaAck }
    /** The server holds no leaf of the root: one full pack, at the server's generation (0 when the root has no row). */
    | { kind: 'full'; touched: string[]; baseGeneration: number }
    /** Exactly these keys differ; `owned` are the server-only leaves the dirty set names (this root's leaves to tombstone). */
    | { kind: 'delta'; touched: string[]; baseGeneration: number; owned: Set<string> };

/** Bucket ids asked for per leaf request. */
const BUCKETS_PER_REQUEST = 512;
const EMPTY_ROOT = manifestTree([]).root;

export async function planReconcile(args: {
    rootId: string;
    local: KnowledgeStore;
    sources: readonly ReplicaSource[];
    client: ReconcileQueries;
    /** The dirty keys now: rows that are not leaves (a person's or agent's) among them are kept, whatever the trees say. */
    dirty?: readonly string[];
}, attempt = 0): Promise<ReconcilePlan> {
    const { rootId, client } = args;
    const [facts, relations] = await Promise.all([args.local.facts({ rootId }), args.local.relations({ rootId })]);
    const tree = manifestTree(rootLeaves(rootId, { files: args.sources.map((x) => ({ path: sourcePathIn(x.ref, rootId), hash: x.hash })), facts, relations }));
    const server = await client.syncManifest(rootId);

    const treeKeys = new Set([...tree.leaves.values()].flat().map((l) => l.key));
    const rowKeys = new Set([...facts.map((f) => factKey(f.key)), ...relations.map(relationKey)]);
    const pending = (args.dirty ?? []).filter((k) => rowKeys.has(k) && !treeKeys.has(k));

    if (server.digest === tree.root) {
        return pending.length === 0
            ? { kind: 'equal', ack: { generation: server.generation, digest: server.digest } }
            : { kind: 'delta', touched: pending, baseGeneration: server.generation, owned: new Set() };
    }
    // Every LEAF goes — model rows and files. A person's note, an agent's fact or a row seeded from the project is
    // not sent here: only those the dirty set names (written locally since) reach the project, through their own writer.
    if (server.digest === EMPTY_ROOT) {
        return { kind: 'full', touched: [...new Set([...treeKeys, ...pending])], baseGeneration: server.generation };
    }

    const differing = differingBuckets(tree.buckets, server.buckets);
    const remote: Array<{ key: string; digest: string }> = [];
    for (let i = 0; i < differing.length; i += BUCKETS_PER_REQUEST) {
        const answer = await client.syncLeaves(rootId, differing.slice(i, i + BUCKETS_PER_REQUEST));
        // The server moved between the two reads: the buckets no longer describe one state.
        if (answer.generation !== server.generation) {
            if (attempt >= 2) throw Object.assign(new Error('the server keeps moving; reconcile again later'), { status: 409 });
            return planReconcile(args, attempt + 1);
        }
        remote.push(...answer.leaves);
    }
    const delta = leafDelta(tree, remote, differing);
    // A server-only leaf is deleted only when the dirty set names it (explicit local evidence); otherwise it is another
    // host's and stays. Nothing left to send is `equal` at the server's own generation and digest: no empty pack, no bump.
    const explicit = new Set(args.dirty ?? []);
    const owned = new Set(delta.remove.filter((k) => explicit.has(k)));
    const touched = [...new Set([...delta.upsert, ...owned, ...pending])];
    if (touched.length === 0) return { kind: 'equal', ack: { generation: server.generation, digest: server.digest } };
    return { kind: 'delta', touched, baseGeneration: server.generation, owned };
}
