/**
 * A quiet root (acked, nothing dirty) still learns that the server invalidated one of its leaves (a healed, lost body):
 * it reads the server's generation on pump start and at most once per interval, and reconciles when it moved.
 */
import { describe, expect, it } from 'vitest';
import { GENERATION_CHECK_INTERVAL_MS, pumpReplica, type ReplicaClient, type ReplicaState } from './replicaPump.js';
import { apiError, fakeServer, hashOf, pathOf, ROOT, world, type World } from './replicaTestkit.test-util.js';

const POISONED = 'healed:body-lost';

const pump = (w: World, client: ReplicaClient, over: Partial<Parameters<typeof pumpReplica>[0]> = {}): Promise<ReplicaState> =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1, ...over });

/** The server healed file 1's lost body: its leaf is poisoned, the body is gone, the generation moved on. */
function poisonFile1(srv: ReturnType<typeof fakeServer>): void {
    srv.s.leaves.set(`f:${pathOf(1)}`, POISONED);
    srv.s.bodies.delete(hashOf(1));
    srv.s.generation += 1;
}

describe('a quiet root checks the server generation', () => {
    it('acked, nothing dirty, server generation = ack + 1: reconciles and sends the poisoned file again', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        await pump(w, srv.client);
        expect(await w.queue.ack()).toMatchObject({ generation: 1 });
        expect(await w.queue.size()).toBe(0);
        poisonFile1(srv);
        srv.log.length = 0;

        const state = await pump(w, srv.client); // a new pump: it starts by asking

        expect(srv.log.map((l) => l.kind).slice(0, 2)).toEqual(['generation', 'manifest']); // the cheap probe first, the full manifest only because it moved
        expect(srv.syncs()).toHaveLength(1);
        expect(srv.syncs()[0]!.pack!.files!.map((f) => f.path)).toEqual([pathOf(1)]); // exactly the poisoned file, not the root
        expect(srv.syncs()[0]!.pack!.extracted?.map((x) => x.hash)).toEqual([hashOf(1)]); // and its body
        expect(srv.s.leaves.get(`f:${pathOf(1)}`)).toBe(hashOf(1));
        expect(state.lastPack).toMatchObject({ mode: 'reconcile', files: 1 });
        expect(await w.queue.ack()).toMatchObject({ generation: srv.s.generation });
    });

    it('asks ONCE per interval: a pump inside it makes no call, one past it makes exactly one generation read (never the manifest)', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        let t = 1_000_000;
        let state = await pump(w, srv.client, { now: () => t });
        srv.log.length = 0;

        state = await pump(w, srv.client, { now: () => t + 1000, initial: state });
        expect(srv.log).toEqual([]);

        t += GENERATION_CHECK_INTERVAL_MS + 1;
        state = await pump(w, srv.client, { now: () => t, initial: state });
        expect(srv.log.map((l) => l.kind)).toEqual(['generation']); // equal generation: nothing else, no per-file call

        state = await pump(w, srv.client, { now: () => t + 1000, initial: state });
        expect(srv.log.map((l) => l.kind)).toEqual(['generation']);
    });

    it('the pump that just synced does not ask again at the end of its own cycle', async () => {
        const w = world();
        await w.review(0, 2);
        const srv = fakeServer();
        await pump(w, srv.client);
        expect(srv.log.filter((l) => l.kind === 'manifest')).toHaveLength(1); // the first sync's own reconcile read
        expect(srv.log.filter((l) => l.kind === 'generation')).toHaveLength(0);
    });

    it('a failing generation read is swallowed: one attempt, no backoff, never "sending", nothing recorded', async () => {
        const w = world();
        await w.review(0, 2);
        const srv = fakeServer();
        await pump(w, srv.client);
        let slept = 0;
        const states: ReplicaState[] = [];
        const down: ReplicaClient = { ...srv.client, syncGeneration: async () => { throw apiError(0); } };

        const state = await pump(w, down, { sleep: async () => { slept += 1; }, onState: (x) => states.push(x) });

        expect(slept).toBe(0);
        expect(states.every((x) => !x.sending)).toBe(true);
        expect(state.failed).toEqual([]);
    });

    it('an ack carrying `reconcile` makes the pump reconcile at once, and the stored ack comes from that reconcile, not the flagged pack', async () => {
        const w = world();
        await w.review(0, 2);
        const srv = fakeServer();
        let flagged = false;
        const client: ReplicaClient = {
            ...srv.client,
            sync: async (root, part) => {
                const ack = await srv.client.sync(root, part);
                if (!flagged && ack.applied) { flagged = true; return { ...ack, digest: 'digest-of-the-flagged-ack', reconcile: true as const }; }
                return ack;
            },
        };
        srv.log.length = 0;

        await pump(w, client);

        const kinds = srv.log.map((l) => l.kind);
        expect(flagged).toBe(true);
        const firstSync = kinds.indexOf('sync');
        expect(kinds.slice(firstSync + 1)).toContain('manifest'); // after the flagged sync, the pump read the manifest to reconcile
        expect(await w.queue.ack()).toEqual({ generation: srv.s.generation, digest: srv.tree().root }); // the reconcile's ack, not 'digest-of-the-flagged-ack'
    });
});

describe('recorded failures are bounded', () => {
    it('keeps the newest 50 across pumps', async () => {
        const w = world();
        await w.review(0, 1);
        const srv = fakeServer();
        srv.s.failSync.push(() => apiError(400));
        const initial: ReplicaState = { dirty: 0, sending: false, failed: Array.from({ length: 80 }, (_, i) => ({ reason: `old ${i}` })) };
        const state = await pump(w, srv.client, { initial });
        expect(state.failed).toHaveLength(50);
        expect(state.failed[0]!.reason).toBe('old 31');
        expect(state.failed[49]!.reason).toContain('400');
    });
});

describe('settle with reconcile', () => {
    it('drops the sent keys and stores NO ack, in one operation', async () => {
        const w = world();
        await w.review(0, 2);
        const snap = await w.queue.snapshot();
        await w.queue.settle(snap, { generation: 4, digest: 'd' }, snap.keys, false, true);
        expect(await w.queue.size()).toBe(0);
        expect(await w.queue.ack()).toBeUndefined();
        await w.queue.settle(snap, { generation: 4, digest: 'd' });
        expect(await w.queue.ack()).toEqual({ generation: 4, digest: 'd' });
    });
});
