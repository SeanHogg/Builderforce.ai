/**
 * The pump's two protections against a pack the server will not take (PRD 41 A11 rule 4b): a `409 body_conflict` is
 * rebuilt and resent at most 3 times and then recorded, and a path or key holding a control character is left out of the
 * pack (the server answers 422 for it) and recorded, instead of stalling the pump.
 */
import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';
import { apiError, extraction, fakeServer, hashOf, pathOf, ROOT, world, type World } from './replicaTestkit.test-util.js';

const pump = (w: World, client: ReplicaClient) =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });

describe('409 body_conflict', () => {
    it('rebuilds and resends, and the next build lands', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        srv.s.failSync.push(() => apiError(409, { code: 'body_conflict' }), () => apiError(409, { code: 'body_conflict' }));
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.dirty).toBe(0);
        expect(srv.s.files.size).toBe(3);
    });

    it('stops after 3 rebuilds with a recorded failure and the work kept', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        let calls = 0;
        const client: ReplicaClient = { ...srv.client, sync: async () => { calls += 1; throw apiError(409, { code: 'body_conflict' }); } };
        const state = await pump(w, client);
        expect(calls).toBe(4); // the first send and 3 rebuilds
        expect(state.failed).toEqual([{ reason: 'knowledge API 409', status: 409 }]);
        expect(state.dirty).toBeGreaterThan(0);
    });
});

describe('a control character in a path or key', () => {
    const addFile = async (w: World, path: string, i: number): Promise<void> => {
        const hash = hashOf(i), ref = srcRef(ROOT, path);
        await w.store.putExtracted!(hash, [extraction(path, hash)]);
        await w.store.markStale({ rootId: ROOT }, ref as never, hash);
        w.sources.push({ ref, hash });
    };

    it('is left out of the pack and recorded, and the rest of the pack lands with its digest', async () => {
        const w = world();
        await w.review(0, 3);
        await addFile(w, 'src/bad\u0001name.ts', 90);
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        const pack = srv.syncs()[0]!.pack!;
        expect(pack.files?.map((f) => f.path)).toEqual([pathOf(0), pathOf(1), pathOf(2)]);
        expect(srv.s.files.size).toBe(3);
        expect(state.failed).toHaveLength(1);
        expect(state.failed[0]!.reason).toMatch(/control character/);
        expect(state.failed[0]!.reason).toContain('src/bad');
        expect(state.dirty).toBe(0);           // settled: it is not retried every cycle
        expect(srv.syncs()).toHaveLength(1);   // and it did not 422 or force a reconcile
    });
});
