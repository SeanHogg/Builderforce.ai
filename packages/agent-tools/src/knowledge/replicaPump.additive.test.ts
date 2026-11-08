/**
 * An ADDITIVE root (reviewed straight against the server before its local store existed) holds server leaves its store lacks.
 * Its pump must never tombstone them; once a complete review ends additive mode it reconciles as before.
 */
import { describe, expect, it } from 'vitest';
import { filesManifestKey } from '@seanhogg/builderforce-memory/knowledge';
import { createReplicaHost } from './replicaHost.js';
import { shouldStayAdditive } from './replicaAdoption.js';
import { pathOfRef } from './replicaPack.js';
import { createReplicaQueue, memoryReplicaPersistence, queuedRootIdOf } from './replicaQueue.js';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';
import { fakeServer, ROOT, world, type World } from './replicaTestkit.test-util.js';

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

const deletesOf = (srv: ReturnType<typeof fakeServer>) => srv.syncs().flatMap((l) => (l.pack?.deletes ? [l.pack.deletes] : []));

describe('regression: an additive root never loses a server leaf it lacks locally', () => {
    it('sends a pack that deletes nothing while additive', async () => {
        const { srv, local } = await adopted();
        await local.queue.setAdditive(true);
        await pump(local, srv.client);
        expect(deletesOf(srv)).toEqual([]);
        expect(srv.s.files.size).toBe(4);
        expect(srv.s.facts.size).toBe(2);
    });

    it('reconciles as today after setAdditive(false): the server-only leaves are tombstoned', async () => {
        const { srv, local } = await adopted();
        await local.queue.setAdditive(true);
        await local.queue.setAdditive(false);
        await pump(local, srv.client);
        expect(deletesOf(srv)).not.toEqual([]);
        expect(srv.s.files.size).toBe(2);
    });

    it('still sends the delete of a file the review saw removed', async () => {
        const { srv, local } = await adopted();
        await local.queue.setAdditive(true);
        local.queue.markDirty(['f:src/f3.ts']); // the review saw f3 go: explicit work, tombstone included
        await pump(local, srv.client);
        expect(srv.s.files.has('src/f3.ts')).toBe(false);
        expect(srv.s.files.size).toBe(3); // f2 stays: only the explicit key went
    });

    it('regression: a server-only human fact (written straight to the server) survives a NON-additive reconcile', async () => {
        const { srv, local } = await adopted();
        const note = { key: 'note:abc', content: 'a person wrote this', source: 'knowledge-graph', importance: 0.6, origin: 'human' as const, fileAnchors: [{ path: 'src/f0.ts' }] };
        await srv.client.writeRows(ROOT, { facts: [note], relations: [] }); // Web / Rovr write human facts to the server only
        await pump(local, srv.client); // additive is off
        expect(srv.s.facts.has('note:abc')).toBe(true);
        expect(srv.s.files.size).toBe(2); // the reconcile ran: the model leaves the store lacks were tombstoned
        expect(deletesOf(srv).flatMap((d) => d.facts ?? [])).not.toContain('note:abc');
    });

    it('regression: two additive hosts, the second holding less than the server, send NO pack and leave the generation alone', async () => {
        const { srv, local } = await adopted();
        const before = srv.s.generation;
        await local.queue.setAdditive(true);
        const state = await pump(local, srv.client);
        expect(srv.syncs()).toEqual([]); // only server-only leaves differ: nothing is this host's to send
        expect(srv.s.generation).toBe(before);
        expect(state.dirty).toBe(0);
    });

    it('regression: an ABORTED first review on a root the server already holds deletes nothing; a complete one ends additive mode', async () => {
        const { srv, local } = await adopted();
        const files = { read: async (n: string) => store.get(n), write: async (n: string, t: string) => { store.set(n, t); } };
        const store = new Map<string, string>();
        const manifest = {
            get: async (key: string) => (key === filesManifestKey(ROOT) ? local.sources.map((s) => ({ id: pathOfRef(ROOT, s.ref), hash: s.hash })) : undefined),
            set: async () => undefined, delete: async () => undefined,
        };
        const source = { rootId: ROOT, files, local: local.local, client: srv.client as never, projectId: 1, manifest: manifest as never };
        const host = createReplicaHost();
        const queue = host.replicaQueueFor(ROOT, files);
        await queue.adopt(1);
        queue.markDirty(local.sources.map((s) => `f:${pathOfRef(ROOT, s.ref)}`));

        // The local store has no completed review of this root: the shared rule keeps it additive before the review starts.
        expect(await shouldStayAdditive(local.local, ROOT)).toBe(true);
        await host.markAdditive(ROOT, files, 1);
        await host.duringReview(ROOT, files, source, async () => ({ aborted: true }), { full: true });
        await host.replicaDrained(ROOT);
        expect(deletesOf(srv)).toEqual([]);
        expect(srv.s.files.size).toBe(4);
        expect(await queue.additive()).toBe(true);

        await host.duringReview(ROOT, files, undefined, async () => ({ aborted: false }), { full: true });
        expect(await queue.additive()).toBe(false);
        await host.disposeReplicas();
    });

    it('regression: marking additive while the queue is bound to project A survives the review\'s adopt of project B, and sends no tombstones', async () => {
        const { srv, local } = await adopted();
        const store = new Map<string, string>();
        const files = { read: async (n: string) => store.get(n), write: async (n: string, t: string) => { store.set(n, t); } };
        const manifest = {
            get: async (key: string) => (key === filesManifestKey(ROOT) ? local.sources.map((s) => ({ id: pathOfRef(ROOT, s.ref), hash: s.hash })) : undefined),
            set: async () => undefined, delete: async () => undefined,
        };
        const host = createReplicaHost();
        const queue = host.replicaQueueFor(ROOT, files);
        await queue.adopt(1); // the root was linked to project A
        await queue.setAdditive(true);
        await host.markAdditive(ROOT, files, 2); // the review is for project B
        await queue.adopt(2); // what the review's first write does: now a no-op
        expect(await queue.additive()).toBe(true);

        queue.markDirty(local.sources.map((s) => `f:${pathOfRef(ROOT, s.ref)}`));
        const source = { rootId: ROOT, files, local: local.local, client: srv.client as never, projectId: 2, manifest: manifest as never };
        await host.duringReview(ROOT, files, source, async () => ({ aborted: true }), { full: false });
        await host.replicaDrained(ROOT);
        expect(deletesOf(srv)).toEqual([]);
        expect(srv.s.files.size).toBe(4);
        await host.disposeReplicas();
    });

    it('a review that stopped judging, or still owes judgement, is not complete: additive stays; a clean one clears it', async () => {
        const host = createReplicaHost();
        const files = { read: async () => undefined, write: async () => undefined };
        const queue = host.replicaQueueFor(ROOT, files);
        for (const report of [{ unjudged: 2 }, { awaitingJudgeCount: 3 }, { awaitingJudge: ['a.ts'] }, { judgeStopped: 'provider failed' }, { readErrors: 1 }, { extractErrors: 1 }]) {
            await host.markAdditive(ROOT, files, 1);
            await host.duringReview(ROOT, files, undefined, async () => ({ aborted: false, ...report }), { full: true });
            expect(await queue.additive()).toBe(true);
        }
        await host.duringReview(ROOT, files, undefined, async () => ({ aborted: false }), { full: false });
        expect(await queue.additive()).toBe(true); // a partial review keeps it too
        await host.duringReview(ROOT, files, undefined, async () => ({ aborted: false, unjudged: 0, awaitingJudgeCount: 0, readErrors: 0, extractErrors: 0 }), { full: true });
        expect(await queue.additive()).toBe(false);
        await host.disposeReplicas();
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

    it('reload never turns additive back on over a complete review here, and ORs it in otherwise', async () => {
        const persistence = memoryReplicaPersistence();
        const mine = createReplicaQueue(persistence);
        await mine.adopt(1);
        await mine.flush();
        const other = createReplicaQueue(persistence);
        await other.setAdditive(true);
        await other.flush();
        await mine.reload();
        expect(await mine.additive()).toBe(true); // another opener marked the root additive
        await mine.setAdditive(false); // a complete review here, not yet saved
        await mine.reload();
        expect(await mine.additive()).toBe(false);
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

    it('shouldStayAdditive: false only once the local store holds a completed review of the root', async () => {
        const w = world();
        expect(await shouldStayAdditive(w.local, ROOT)).toBe(true);
        await w.local.write({ scope: { rootId: ROOT, title: 't', packs: [], lastDigest: 'dg' }, facts: [], relations: [] });
        expect(await shouldStayAdditive(w.local, ROOT)).toBe(false);
    });

    it('a second tab\'s additive mark survives this tab\'s save (the file is merged, never overwritten with false)', async () => {
        const persistence = memoryReplicaPersistence();
        const tabA = createReplicaQueue(persistence);
        const tabB = createReplicaQueue(persistence);
        expect(await tabA.additive()).toBe(false); // A loaded the file: not additive
        await tabB.setAdditive(true);
        await tabB.flush();
        tabA.markDirty(['f:x.ts']);
        await tabA.flush(); // A saves its state back
        expect(await createReplicaQueue(persistence).additive()).toBe(true);
        await tabA.setAdditive(false); // an explicit turn-off IS written
        await tabA.flush();
        expect(await createReplicaQueue(persistence).additive()).toBe(false);
    });

    it('persists in the dirty file, and a file without the field reads as not additive', async () => {
        const persistence = memoryReplicaPersistence();
        const a = createReplicaQueue(persistence);
        expect(await a.additive()).toBe(false);
        await a.setAdditive(true);
        await a.flush();
        expect(await createReplicaQueue(persistence).additive()).toBe(true);
        await a.setAdditive(false);
        await a.flush();
        expect(JSON.parse((await persistence.read())!)).not.toHaveProperty('additive');
        expect(await createReplicaQueue(persistence).additive()).toBe(false);
    });
});
