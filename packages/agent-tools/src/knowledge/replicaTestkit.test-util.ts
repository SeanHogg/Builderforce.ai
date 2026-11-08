/**
 * knowledge/replicaTestkit.test-util.ts — a local root and a fake project server for the replica tests (PRD 41 A11).
 * The server applies real BFKP packs with the shared codec and checks generation and digest as the API does, so a
 * test of the pump is a test of the whole wire contract.
 */

import { localSnapshotStore, srcRef, type Extracted, type KnowledgeStore, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    applyEntryDiffs, decodePack, factDigest, factLeafKey, fileLeafKey, joinParts, manifestTree, relationDigest, relationLeafKey, ZERO_DIGEST, type Pack,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { createReplicaQueue, factKey, memoryReplicaPersistence, relationKey, type ReplicaPersistence, type ReplicaQueue } from './replicaQueue.js';
import { replicatedKnowledgeStore } from './replicatedStore.js';
import type { ReplicaClient } from './replicaPump.js';

export const ROOT = 'ws:test';
export const scope = { rootId: ROOT, title: 'test', packs: ['code'] };

export const hashOf = (i: number, rev = 0): string => `${i.toString(16)}${rev.toString(16)}`.padStart(64, 'c');
export const pathOf = (i: number): string => `src/f${i}.ts`;

export const extraction = (path: string, hash: string, nodes = 2): Extracted => ({
    sourceRef: srcRef(ROOT, path), sourceHash: hash,
    nodes: Array.from({ length: nodes }, (_, i) => ({ ref: `${srcRef(ROOT, path)}#n${i}` as never, kind: 'symbol', label: `n${i}`, pack: 'code', importance: 0.25, origin: 'extracted' as const, sourceHash: hash })),
    edges: [], keys: [],
});

export const factOf = (key: string, path: string): StoredFact => ({ key, content: `about ${path}`, source: 'review', importance: 0.5, origin: 'model', fileAnchors: [{ path }] });

/** An error shaped like the knowledge client's. */
export const apiError = (status: number, extra: { retryAfterMs?: number; code?: string; hashes?: string[] } = {}) =>
    Object.assign(new Error(`knowledge API ${status}`), { status, ...extra });

export interface World {
    local: KnowledgeStore;
    queue: ReplicaQueue;
    persistence: ReplicaPersistence;
    store: KnowledgeStore;
    sources: Array<{ ref: string; hash: string }>;
    /** Writes files `[from, to)` through the replicated store at revision `rev`, as a review would. */
    review(from: number, to: number, rev?: number, nodes?: number): Promise<void>;
}

export function world(opts: { projectId?: number; persistence?: ReplicaPersistence } = {}): World {
    let text: string | undefined;
    const local = localSnapshotStore({ read: async () => text, write: async (t) => { text = t; } });
    const persistence = opts.persistence ?? memoryReplicaPersistence();
    const queue = createReplicaQueue(persistence);
    const sources: World['sources'] = [];
    const store = replicatedKnowledgeStore({
        local, rootId: ROOT, replica: { projectId: opts.projectId ?? 1 }, queue,
        knownHashes: async () => new Map(sources.map((s) => [s.ref, s.hash])),
    });
    const w: World = {
        local, queue, persistence, store, sources,
        async review(from, to, rev = 0, nodes = 2) {
            for (let i = from; i < to; i++) {
                const hash = hashOf(i, rev), ref = srcRef(ROOT, pathOf(i));
                await store.putExtracted!(hash, [extraction(pathOf(i), hash, nodes)]);
                await store.markStale({ rootId: ROOT }, ref as never, hash);
                const at = sources.findIndex((s) => s.ref === ref);
                if (at >= 0) sources[at] = { ref, hash }; else sources.push({ ref, hash });
                if (rev === 0 && i % 2 === 0) await store.write({ scope, facts: [factOf(`claim:${i}`, pathOf(i))], relations: [] });
            }
        },
    };
    return w;
}

export type Logged = { kind: 'sync' | 'manifest' | 'generation' | 'leaves' | 'have'; bytes?: number; pack?: Pack; part?: number };

export function fakeServer() {
    const s = {
        generation: 0,
        files: new Map<string, string>(), facts: new Map<string, StoredFact>(), relations: new Map<string, StoredRelation>(), bodies: new Map<string, Extracted[]>(),
        /** Refuse (413 pack_too_large) a pack carrying more files than this. */
        rejectOver: Infinity,
        /** Errors thrown by the next `sync` calls, in order, before anything is applied. */
        failSync: [] as Array<() => unknown>,
        /** Pairs a client DECLARED entry-less (an explicit empty body), as `pairOf`: they satisfy the by-pair body check but are never a have-answer. */
        entryless: new Set<string>(),
        /** key → digest: the root's leaves on the server. */
        leaves: new Map<string, string>(),
        /** Rows written through the single writer (`writeRows`), not the pack. */
        sideWrites: [] as Array<{ facts: StoredFact[]; relations: StoredRelation[] }>,
    };
    const log: Logged[] = [];
    const pairOf = (hash: string, ref: string): string => `${hash}|${ref}`;
    const entryFor = (hash: string, ref: string): boolean => s.bodies.get(hash)?.some((e) => e.sourceRef === ref) === true;
    const staged = new Map<string, Uint8Array[]>();
    // The manifest is the LEAVES this root synced (rule 4b), exactly as the API keeps them — never the shared rows.
    const tree = () => manifestTree([...s.leaves].map(([key, digest]) => ({ key, digest })));
    const fail = (status: number, code: string, extra: object = {}) => apiError(status, { code, ...extra });

    const client: ReplicaClient = {
        sync: async (_root, part) => {
            const next = s.failSync.shift();
            if (next) throw next();
            let bytes = part.bytes;
            if (part.parts && part.parts > 1) {
                const list = staged.get(part.syncId!) ?? [];
                list[part.part!] = part.bytes;
                staged.set(part.syncId!, list);
                log.push({ kind: 'sync', bytes: part.bytes.length, part: part.part! });
                if (part.part !== part.parts - 1) return { applied: false as const, received: part.part! + 1, parts: part.parts };
                bytes = joinParts(list);
            }
            const pack = await decodePack(bytes);
            if (!(part.parts && part.parts > 1)) log.push({ kind: 'sync', bytes: part.bytes.length, pack });
            else log[log.length - 1]!.pack = pack;
            // A full pack (generation 0) only while the root has no row; any other at the current generation.
            if (pack.baseGeneration !== s.generation) throw fail(409, 'generation_mismatch', { generation: s.generation });
            if ((pack.files?.length ?? 0) > s.rejectOver) throw fail(413, 'pack_too_large');
            const tomb = [
                ...(pack.deletes?.files ?? []).map((id) => `f:${id}`), ...(pack.deletes?.facts ?? []).map(factLeafKey), ...(pack.deletes?.relations ?? []).map(relationLeafKey),
            ];
            if (tomb.some((k) => !s.leaves.has(k))) throw fail(422, 'not_owned');
            // As the server's verifyBodies: a file whose body the pack leaves out must be held BY PAIR (an entry, or declared entry-less).
            const shipped = new Set((pack.extracted ?? []).map((x) => x.hash));
            const missing = new Set((pack.files ?? []).filter((f) => !shipped.has(f.hash) && !entryFor(f.hash, srcRef(ROOT, f.path)) && !s.entryless.has(pairOf(f.hash, srcRef(ROOT, f.path)))).map((f) => f.hash));
            if (missing.size > 0) throw fail(409, 'extracted_missing', { hashes: [...missing] });
            const savedEntryless = new Set(s.entryless);
            const saved = { files: new Map(s.files), facts: new Map(s.facts), relations: new Map(s.relations), leaves: new Map(s.leaves), bodies: new Map(s.bodies) };
            for (const x of pack.extracted ?? []) {
                // As the real server: the stored body is the UNION by sourceRef of what is held and what arrived (an empty arrival erases nothing).
                const arrival = x.kind === 'full' ? x.entries : applyEntryDiffs(s.bodies.get(x.prior) ?? [], x.entries);
                const arrived = new Set(arrival.map((e) => e.sourceRef));
                s.bodies.set(x.hash, [...(s.bodies.get(x.hash) ?? []).filter((e) => !arrived.has(e.sourceRef)), ...arrival]);
                if (x.kind === 'full' && x.entries.length === 0) for (const f of pack.files ?? []) if (f.hash === x.hash) s.entryless.add(pairOf(x.hash, srcRef(ROOT, f.path)));
            }
            for (const f of pack.files ?? []) { s.files.set(f.path, f.hash); s.leaves.set(fileLeafKey(f.path, f.hash), f.hash); }
            for (const f of pack.facts ?? []) { s.facts.set(f.key, f); s.leaves.set(factLeafKey(f.key), factDigest(f)); }
            for (const r of pack.relations ?? []) { s.relations.set(relationKey(r), r); s.leaves.set(relationLeafKey(r), relationDigest(r)); }
            for (const p of pack.deletes?.files ?? []) s.files.delete(p);
            for (const k of pack.deletes?.facts ?? []) s.facts.delete(k);
            for (const r of pack.deletes?.relations ?? []) s.relations.delete(relationKey(r));
            for (const k of tomb) s.leaves.delete(k);
            if (pack.targetDigest !== ZERO_DIGEST && tree().root !== pack.targetDigest) {
                // A transaction: nothing the pack did is kept.
                s.files = saved.files; s.facts = saved.facts; s.relations = saved.relations; s.leaves = saved.leaves; s.bodies = saved.bodies; s.entryless = savedEntryless;
                throw fail(409, 'digest_mismatch');
            }
            s.generation += 1;
            return { applied: true as const, generation: s.generation, digest: tree().root };
        },
        syncManifest: async () => { log.push({ kind: 'manifest' }); const t = tree(); return { generation: s.generation, digest: t.root, buckets: t.buckets }; },
        syncGeneration: async () => { log.push({ kind: 'generation' }); return { generation: s.generation, digest: tree().root }; },
        syncLeaves: async (_r, ids) => { log.push({ kind: 'leaves' }); const t = tree(); return { generation: s.generation, leaves: ids.flatMap((b) => t.leaves.get(b) ?? []) }; },
        syncHave: async (_r, pairs) => { log.push({ kind: 'have' }); return pairs.map((p) => entryFor(p.hash, p.sourceRef)); },
        writeRows: async (_r, rows) => {
            s.sideWrites.push({ facts: [...rows.facts], relations: [...rows.relations] });
            for (const f of rows.facts) s.facts.set(f.key, f);
            for (const r of rows.relations) s.relations.set(relationKey(r), r);
        },
    };
    return { s, client, log, tree, syncs: () => log.filter((l) => l.kind === 'sync') };
}

export { factKey };
