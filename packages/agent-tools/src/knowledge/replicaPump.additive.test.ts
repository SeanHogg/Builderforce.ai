/**
 * An ADDITIVE root (reviewed straight against the server before its local store existed) holds server leaves its store lacks.
 * Its pump must never tombstone them; once a complete review ends additive mode it reconciles as before.
 */
import { describe, expect, it } from 'vitest';
import { createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';
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
