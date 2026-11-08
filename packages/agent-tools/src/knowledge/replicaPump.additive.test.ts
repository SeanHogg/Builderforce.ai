/**
 * A DELETION ONLY EVER COMES FROM EXPLICIT LOCAL EVIDENCE (a key in the dirty set). A leaf the server holds that this store
 * merely lacks belongs to another host sharing the root, and no reconcile tombstones it — however complete this store's review.
 */
import { describe, expect, it } from 'vitest';
import { createReplicaQueue, memoryReplicaPersistence, queuedRootIdOf } from './replicaQueue.js';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';
import { fakeServer, pathOf, ROOT, scope, world, type World } from './replicaTestkit.test-util.js';

const pump = (w: World, client: ReplicaClient) =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });

/** A server holding four files (and the facts of the even ones), and a NEW local store that knows only the first two. */
async function adopted() {
    const srv = fakeServer();
    const first = world();
    await first.review(0, 4);
    await pump(first, srv.client);
    expect(srv.s.files.size).toBe(4);
    srv.log.length = 0;
    const local = world();
    await local.review(0, 2);
    return { srv, local };
}

/** The local store records a COMPLETED review of the root (its scope carries the review's digest). */
const completeReview = (w: World, digest: string) => w.local.write({ scope: { ...scope, lastDigest: digest, lastReviewedAt: '2026-11-08T00:00:00Z' }, facts: [], relations: [] });

const deletesOf = (srv: ReturnType<typeof fakeServer>) => srv.syncs().flatMap((l) => (l.pack?.deletes ? [l.pack.deletes] : []));

describe('regression: a reconcile never deletes a server leaf this store merely lacks', () => {
    it('sends a pack that deletes nothing for the leaves only the server holds', async () => {
        const { srv, local } = await adopted();
        await pump(local, srv.client);
        expect(deletesOf(srv)).toEqual([]);
        expect(srv.s.files.size).toBe(4);
        expect(srv.s.facts.size).toBe(2);
    });

    it('still sends the delete of a file the review saw removed (the dirty set names it)', async () => {
        const { srv, local } = await adopted();
        local.queue.markDirty(['f:src/f3.ts']); // the review saw f3 go: explicit work, tombstone included
        await pump(local, srv.client);
        expect(srv.s.files.has('src/f3.ts')).toBe(false);
        expect(srv.s.files.size).toBe(3); // f2 stays: only the explicit key went
    });

    it('regression: a server-only human fact (written straight to the server) survives a reconcile', async () => {
        const { srv, local } = await adopted();
        const note = { key: 'note:abc', content: 'a person wrote this', source: 'knowledge-graph', importance: 0.6, origin: 'human' as const, fileAnchors: [{ path: 'src/f0.ts' }] };
        await srv.client.writeRows(ROOT, { facts: [note], relations: [] }); // Web / Rovr write human facts to the server only
        await pump(local, srv.client);
        expect(srv.s.facts.has('note:abc')).toBe(true);
        expect(srv.s.files.size).toBe(4);
        expect(deletesOf(srv).flatMap((d) => d.facts ?? [])).not.toContain('note:abc');
    });

    it('regression: a host holding less than the server sends NO pack and leaves the generation alone', async () => {
        const { srv, local } = await adopted();
        const before = srv.s.generation;
        const state = await pump(local, srv.client);
        expect(srv.syncs()).toEqual([]); // only server-only leaves differ: nothing is this host's to send
        expect(srv.s.generation).toBe(before);
        expect(state.dirty).toBe(0);
    });

    it('regression: two hosts that both fully reviewed a root never delete each other\'s leaves', async () => {
        const srv = fakeServer();
        const a = world(), b = world();
        await a.review(0, 2); // machine A holds f0, f1
        await completeReview(a, 'a'.repeat(64));
        await b.review(2, 4); // machine B holds f2, f3
        await completeReview(b, 'b'.repeat(64));

        await pump(a, srv.client);
        await pump(b, srv.client); // no ack: B reconciles against a server holding A's leaves
        await a.queue.requestReconcile();
        await pump(a, srv.client); // and A reconciles against B's
        expect(deletesOf(srv)).toEqual([]);
        expect(new Set(srv.s.files.keys())).toEqual(new Set([0, 1, 2, 3].map(pathOf)));

        // An explicit removal on one machine still goes: B's review saw f3 removed.
        b.sources.splice(b.sources.findIndex((s) => s.ref.endsWith(pathOf(3))), 1);
        b.queue.markDirty([`f:${pathOf(3)}`]);
        await pump(b, srv.client);
        expect(new Set(srv.s.files.keys())).toEqual(new Set([0, 1, 2].map(pathOf)));
    });

    it('regression: a tab that reloads the shared queue file takes the other tab\'s newer ack and keeps its unsent keys beside its own', async () => {
        const srv = fakeServer();
        const a = world();
        await a.review(0, 2);
        await pump(a, srv.client); // ack at generation 1
        await a.queue.flush();

        // Another tab over the SAME local store and queue file: it sent a pack (a newer ack), then marked f1 again without sending it.
        const other = createReplicaQueue(a.persistence);
        await other.settle(await other.snapshot(), { generation: 7, digest: 'd'.repeat(64) });
        other.markDirty(['f:src/f1.ts']);
        await other.flush();

        await a.review(0, 1, 1); // this tab changes f0: unsaved here
        await a.queue.reload();
        expect(await a.queue.ack()).toEqual({ generation: 7, digest: 'd'.repeat(64) });
        const keys = (await a.queue.snapshot()).keys;
        expect(keys).toContain('f:src/f1.ts'); // the other tab's key survives this tab's next save
        expect(keys.some((k) => k.startsWith('f:src/f0.ts'))).toBe(true);
        await a.queue.flush();
        expect(JSON.parse((await a.persistence.read())!).dirty).toContain('f:src/f1.ts');
    });

    it('persists the root id in the queue file; queuedRootIdOf reads it back and an older file without it returns undefined', async () => {
        const persistence = memoryReplicaPersistence();
        const queue = createReplicaQueue(persistence, { rootId: 'ws:abc' });
        queue.markDirty(['f:x.ts']);
        await queue.flush();
        expect(queuedRootIdOf((await persistence.read())!)).toBe('ws:abc');
        expect(queuedRootIdOf(JSON.stringify({ version: 2, projectId: 1, dirty: ['f:x.ts'] }))).toBeUndefined();
        expect(queuedRootIdOf('not json')).toBeUndefined();
        const old = memoryReplicaPersistence();
        await old.write(JSON.stringify({ version: 2, projectId: 1, dirty: ['f:x.ts'] }));
        expect(await createReplicaQueue(old, { rootId: 'ws:abc' }).size()).toBe(1); // an old file still loads
    });

    it('an older queue file carrying the retired `additive: true` loads unharmed and the field is dropped on the next save', async () => {
        const persistence = memoryReplicaPersistence();
        await persistence.write(JSON.stringify({ version: 2, projectId: 1, dirty: ['f:x.ts'], additive: true }));
        const queue = createReplicaQueue(persistence);
        expect(await queue.size()).toBe(1);
        expect(await queue.projectId()).toBe(1);
        queue.markDirty(['f:y.ts']);
        await queue.flush();
        const saved = JSON.parse((await persistence.read())!);
        expect(saved).not.toHaveProperty('additive');
        expect(saved.dirty).toEqual(['f:x.ts', 'f:y.ts']);
    });
});
