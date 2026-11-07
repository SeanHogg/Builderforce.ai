/**
 * knowledge/replicaReconcile.ts — the RECONCILE path of a sync (PRD 41 A11 rule 2): finding the delta
 * with the manifest tree when there is no ack, the server's generation moved, the dirty set was lost
 * or a 409 came back.
 *
 * Both sides compute the same `manifestTree` over the root (files, facts, relations). The client reads
 * the server's root digest and 4,096 bucket digests (one GET, at most 128 KB), asks only for the leaves of
 * the buckets that differ, and the touched keys are exactly the leaves the server lacks or holds with
 * another digest, plus the keys the server holds that the client does not (tombstones). Equal root
 * digests mean nothing is sent. A full pack is planned only when the server holds nothing for the root.
 */

import type { KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import {
    differingBuckets, leafDelta, manifestTree, rootLeaves,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { pathOfRef, type ReplicaSource } from './replicaPack.js';
import { factKey, relationKey, type ReplicaAck } from './replicaQueue.js';

export interface ReconcileQueries {
    syncManifest(rootId: string): Promise<{ generation: number; digest: string; buckets: string[] }>;
    syncLeaves(rootId: string, bucketIds: readonly number[]): Promise<{ generation: number; leaves: Array<{ key: string; digest: string }> }>;
}

export type ReconcilePlan =
    /** Nothing differs: the dirty set is satisfied. */
    | { kind: 'equal'; ack: ReplicaAck }
    /** The server holds nothing for the root: one full pack (`baseGeneration` 0). */
    | { kind: 'full'; touched: string[] }
    /** Exactly these keys differ. */
    | { kind: 'delta'; touched: string[]; baseGeneration: number };

/** Bucket ids asked for per leaf request. */
const BUCKETS_PER_REQUEST = 512;
const EMPTY_ROOT = manifestTree([]).root;

export async function planReconcile(args: {
    rootId: string;
    local: KnowledgeStore;
    sources: readonly ReplicaSource[];
    client: ReconcileQueries;
    /** The dirty keys now: those whose rows the digest does not cover (a person's or agent's) are sent whatever the trees say. */
    dirty?: readonly string[];
}, attempt = 0): Promise<ReconcilePlan> {
    const { rootId, client } = args;
    const [facts, relations] = await Promise.all([args.local.facts({ rootId }), args.local.relations({ rootId })]);
    const tree = manifestTree(rootLeaves(rootId, { files: args.sources.map((x) => ({ path: pathOfRef(rootId, x.ref), hash: x.hash })), facts, relations }));
    const server = await client.syncManifest(rootId);
    const uncovered = new Set(facts.filter((f) => f.origin !== 'model').map((f) => factKey(f.key)));
    for (const r of relations) if (r.origin !== 'model') uncovered.add(relationKey(r));
    const pending = (args.dirty ?? []).filter((k) => uncovered.has(k));
    if (server.digest === tree.root) {
        return pending.length === 0
            ? { kind: 'equal', ack: { generation: server.generation, digest: server.digest } }
            : { kind: 'delta', touched: pending, baseGeneration: server.generation };
    }
    // Every local row goes (the digest covers only the review's own judgements; a person's notes still belong on the project).
    if (server.digest === EMPTY_ROOT) {
        const files = [...tree.leaves.values()].flat().map((l) => l.key).filter((k) => k.startsWith('f:'));
        return { kind: 'full', touched: [...files, ...facts.map((f) => factKey(f.key)), ...relations.map(relationKey)] };
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
    return { kind: 'delta', touched: [...new Set([...delta.upsert, ...delta.remove, ...pending])], baseGeneration: server.generation };
}
