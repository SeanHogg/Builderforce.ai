/**
 * The pump's rules about WHAT it sends and when it gives up (PRD 41 A11 rules 2, 4b): only model leaves ride the pack,
 * everything else goes through its own writer; a tombstone names only keys the server holds as this root's leaves;
 * a 4xx is never retried and a 5xx gives up after a streak.
 */
import { describe, expect, it } from 'vitest';
import { factKey, fileKey } from './replicaQueue.js';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';
import { apiError, factOf, fakeServer, pathOf, ROOT, scope, world, type World } from './replicaTestkit.test-util.js';

const live = () => new AbortController().signal;
const pump = (w: World, client: ReplicaClient, over: Partial<Parameters<typeof pumpReplica>[0]> = {}) =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: live(), rootId: ROOT, sources: async () => w.sources, projectId: 1, ...over });

describe('what rides the pack, and what does not', () => {
    it('a person\'s note goes through the single writer, never the pack; the model rows ride the pack', async () => {
        const w = world();
        await w.review(0, 4);
        const note = { ...factOf('note:1', pathOf(1)), origin: 'human' as const };
        await w.store.write({ scope, facts: [note], relations: [] });
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        const pack = srv.syncs()[0]!.pack!;
        expect(pack.facts?.map((f) => f.key)).not.toContain('note:1');
        expect(pack.facts?.every((f) => f.origin === 'model')).toBe(true);
        expect(srv.s.sideWrites).toHaveLength(1);
        expect(srv.s.sideWrites[0]!.facts.map((f) => f.key)).toEqual(['note:1']);
        expect(srv.s.leaves.has(factKey('note:1'))).toBe(false);   // a note is never a leaf, so it never makes the trees differ
        expect(state.dirty).toBe(0);
    });

    it('a note the server refuses (4xx) is final: it leaves the dirty set and is reported, while the pack still lands', async () => {
        const w = world();
        await w.review(0, 2);
        await w.store.write({ scope, facts: [{ ...factOf('note:1', pathOf(0)), origin: 'human' as const }], relations: [] });
        const srv = fakeServer();
        const client: ReplicaClient = { ...srv.client, writeRows: async () => { throw apiError(400, { code: 'origin_mismatch' }); } };
        const state = await pump(w, client);
        expect(srv.s.files.size).toBe(2);
        expect(state.failed).toEqual([{ reason: 'knowledge API 400', status: 400 }]);
        expect((await w.queue.snapshot()).keys).toEqual([]);   // retrying a refusal every cycle can never succeed
        expect(state.dirty).toBe(0);
    });

    it('a note that fails transiently (5xx or a non-HTTP error) stays dirty for the next cycle, while the pack still lands', async () => {
        const failures: Array<() => unknown> = [() => apiError(503), () => new Error('socket hang up')];
        for (const fail of failures) {
            const w = world();
            await w.review(0, 2);
            await w.store.write({ scope, facts: [{ ...factOf('note:1', pathOf(0)), origin: 'human' as const }], relations: [] });
            const srv = fakeServer();
            const client: ReplicaClient = { ...srv.client, writeRows: async () => { throw fail(); } };
            await pump(w, client, { maxTransientStreak: 1, sleep: async () => undefined });
            expect(srv.s.files.size).toBe(2);
            expect((await w.queue.snapshot()).keys).toContain(factKey('note:1'));   // a 5xx pauses the pump before the pack settles, so the rest stays too
        }
    });
});

describe('tombstones name only this root\'s leaves', () => {
    it('a dirty key the server never held is dropped quietly: no tombstone, no 422', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        await pump(w, srv.client);
        w.queue.markDirty([fileKey('src/ghost.ts', ''), factKey('claim:gone')]);
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.dirty).toBe(0);
        expect(srv.syncs().at(-1)!.pack!.deletes).toBeUndefined();
    });

    it('a file removed locally that the server holds as a leaf is tombstoned', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        await pump(w, srv.client);
        const gone = w.sources.pop()!;
        await w.store.markStale({ rootId: ROOT }, gone.ref as never, '');
        await pump(w, srv.client);
        expect(srv.syncs().at(-1)!.pack!.deletes?.files).toEqual([pathOf(2)]);
        expect(srv.s.leaves.has(fileKey(pathOf(2), ''))).toBe(false);
    });
});

describe('giving up', () => {
    it('a 4xx is not retried: one request, recorded, the dirty set kept', async () => {
        for (const status of [400, 404, 410, 422]) {
            const w = world();
            await w.review(0, 2);
            const srv = fakeServer();
            let calls = 0;
            const client: ReplicaClient = { ...srv.client, sync: async () => { calls += 1; throw apiError(status, { code: 'nope' }); } };
            const waits: number[] = [];
            const state = await pump(w, client, { sleep: async (ms) => { waits.push(ms); } });
            expect(calls).toBe(1);
            expect(waits).toEqual([]);
            expect(state.failed).toHaveLength(1);
            expect(state.dirty).toBeGreaterThan(0);
        }
    });

    it('a 5xx gives up after maxTransientStreak in a row (paused: unreachable) and waits between tries', async () => {
        const w = world();
        await w.review(0, 2);
        const srv = fakeServer();
        let calls = 0;
        const client: ReplicaClient = { ...srv.client, sync: async () => { calls += 1; throw apiError(503); } };
        const waits: number[] = [];
        const state = await pump(w, client, { maxTransientStreak: 8, sleep: async (ms) => { waits.push(ms); } });
        expect(calls).toBe(8);
        expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000]);
        expect(state).toMatchObject({ paused: 'unreachable', pausedStatus: 503 });
        expect(state.dirty).toBeGreaterThan(0);
    });

    it('an analysis snapshot too large to ever send is dropped and reported, not looped on', async () => {
        const w = world();
        await w.review(0, 2);
        w.queue.setAnalysis({ sha: 'abc123', snapshot: { blob: 'x'.repeat(2.2 * 1024 * 1024) } });
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([{ reason: 'the code analysis snapshot is over 2 MB and was not sent', status: 413 }]);
        expect((await w.queue.snapshot()).analysis).toBeUndefined();
        expect(srv.syncs()).toHaveLength(1);
        expect(srv.syncs()[0]!.pack!.analysis).toBeUndefined();
    });
});

describe('the dirty set while a reconcile runs', () => {
    it('keeps what was marked after the snapshot the reconcile read', async () => {
        const w = world();
        await w.review(0, 3);
        const snap = await w.queue.snapshot();
        w.queue.markDirty([fileKey('src/late.ts', '')]);
        await w.queue.replaceDirty([fileKey(pathOf(0), '')], snap);
        expect((await w.queue.snapshot()).keys.sort()).toEqual([fileKey('src/late.ts', ''), fileKey(pathOf(0), '')].sort());
    });
});

