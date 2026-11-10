/**
 * The A11 accept list at the pump (PRD 41): delta not replay, reconcile instead of re-upload, content-addressed
 * bodies sent once, within-file diffs, parts over 8 MB, and a 409 that reconciles and sends only the difference.
 */
import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { pumpReplica, type ReplicaState } from './replicaPump.js';
import { extraction, fakeServer, hashOf, pathOf, ROOT, world, type World } from './replicaTestkit.test-util.js';

const live = () => new AbortController().signal;
const pump = (w: World, client: ReturnType<typeof fakeServer>['client'], over: Partial<Parameters<typeof pumpReplica>[0]> = {}): Promise<ReplicaState> =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: live(), rootId: ROOT, sources: async () => w.sources, projectId: 1, ...over });

describe('delta, not replay', () => {
    it('a re-review that changes 10 files sends ONE request under 50 KB, with no manifest read', async () => {
        const w = world();
        await w.review(0, 300);
        const srv = fakeServer();
        await pump(w, srv.client);
        srv.log.length = 0;

        await w.review(0, 300, 0);          // an unchanged re-review marks nothing
        expect(await w.queue.size()).toBe(0);
        await w.review(40, 50, 1);          // 10 files change
        expect(await w.queue.size()).toBe(10);

        const state = await pump(w, srv.client);
        const syncs = srv.syncs();
        expect(syncs).toHaveLength(1);
        expect(syncs[0]!.bytes!).toBeLessThan(50 * 1024);
        expect(srv.log.some((l) => l.kind === 'manifest')).toBe(false);
        expect(syncs[0]!.pack!.baseGeneration).toBe(1);
        expect(syncs[0]!.pack!.files).toHaveLength(10);
        expect(state.dirty).toBe(0);
        expect(srv.s.files.get(pathOf(41))).toBe(hashOf(41, 1));
    }, 30_000); // a 300-file review: slow runners pass 10 s

    it('a removed file travels as a tombstone', async () => {
        const w = world();
        await w.review(0, 6);
        const srv = fakeServer();
        await pump(w, srv.client);
        const gone = w.sources.pop()!;
        await w.store.markStale({ rootId: ROOT }, gone.ref as never, '');
        await pump(w, srv.client);
        expect(srv.s.files.has(pathOf(5))).toBe(false);
        expect(srv.syncs().at(-1)!.pack!.deletes?.files).toEqual([pathOf(5)]);
    });

    it('does not mark a key dirty when its content did not change, and saves the set at most once a second', async () => {
        const writes: string[] = [];
        const w = world({ persistence: { read: async () => undefined, write: async (t: string) => { writes.push(t); } } });
        await w.review(0, 50);
        await w.review(0, 50);              // the same hashes again
        expect(await w.queue.size()).toBe(50 + 25);
        expect(writes).toHaveLength(0);     // throttled: nothing saved inside the review's steps
        await w.queue.flush();
        expect(writes).toHaveLength(1);
        await w.queue.flush();
        expect(writes).toHaveLength(1);     // and only when something changed
    });
});

describe('reconcile', () => {
    it('two clients with identical state send nothing: one manifest read each', async () => {
        const a = world(), b = world();
        await a.review(0, 40);
        await b.review(0, 40);
        const srv = fakeServer();
        await pump(a, srv.client);
        srv.log.length = 0;
        const state = await pump(b, srv.client);
        expect(srv.log.map((l) => l.kind)).toEqual(['manifest']);
        expect(state.dirty).toBe(0);
        expect(await b.queue.ack()).toMatchObject({ generation: 1 });
    });

    it('re-linking a root the server holds, with 10 files changed, sends the leaves of the differing buckets and a pack under 50 KB', async () => {
        const first = world();
        await first.review(0, 400);
        const srv = fakeServer();
        await pump(first, srv.client);
        srv.log.length = 0;

        const relinked = world();           // a second machine: no ack, and a dirty set of everything it reviewed
        await relinked.review(0, 400);
        await relinked.review(100, 110, 1);
        const state = await pump(relinked, srv.client);

        const kinds = srv.log.map((l) => l.kind);
        expect(kinds.filter((k) => k === 'manifest')).toHaveLength(1);
        expect(kinds.filter((k) => k === 'sync')).toHaveLength(1);
        const sent = srv.syncs()[0]!;
        expect(sent.bytes!).toBeLessThan(50 * 1024);
        expect(sent.pack!.files).toHaveLength(10);
        expect(sent.pack!.baseGeneration).toBe(1);
        expect(state.dirty).toBe(0);
        expect(srv.s.files.get(pathOf(105))).toBe(hashOf(105, 1));
    }, 30_000); // two 400-file reviews: slow runners pass 10 s

    it('a 409 (another machine synced meanwhile) reconciles and sends only the difference', async () => {
        const w = world();
        await w.review(0, 100);
        const srv = fakeServer();
        await pump(w, srv.client);
        // Another machine adds a file the server now holds; this one edits file 7.
        srv.s.files.set('other/new.ts', hashOf(900));
        srv.s.leaves.set('f:other/new.ts', hashOf(900));      // the other machine's leaf: this root's, on the server
        srv.s.generation += 1;
        await w.review(7, 8, 1);
        srv.log.length = 0;
        const state = await pump(w, srv.client);
        expect(srv.s.files.get(pathOf(7))).toBe(hashOf(7, 1));
        const kinds = srv.log.map((l) => l.kind);
        expect(kinds).toContain('manifest');
        // The server holds a file this machine does not: it is the other machine's, and the reconcile leaves it alone
        // (a deletion only ever comes from this machine's dirty set).
        expect(srv.s.files.get('other/new.ts')).toBe(hashOf(900));
        expect(srv.syncs().at(-1)!.pack!.deletes).toBeUndefined();
        expect(state.dirty).toBe(0);
        expect(state.failed).toEqual([]);
        expect(state.lastPack!.mode).toBe('reconcile');
        expect(srv.syncs().at(-1)!.pack!.files).toHaveLength(1);
    });
});

describe('content-addressed bodies and within-file diffs', () => {
    it('a file whose content hash the server already holds (under any root) sends no EXTR body', async () => {
        const w = world();
        await w.review(0, 3);
        const srv = fakeServer();
        srv.s.bodies.set(hashOf(1), [extraction(pathOf(1), hashOf(1))]);   // another root uploaded it
        await pump(w, srv.client);
        const pack = srv.syncs()[0]!.pack!;
        expect(pack.extracted!.map((x) => x.hash).sort()).toEqual([hashOf(0), hashOf(2)].sort());
        expect(pack.files).toHaveLength(3);
    });

    it('adding one function to a big file sends that node, not the file extraction', async () => {
        const w = world();
        await w.review(0, 1, 0, 600);
        const srv = fakeServer();
        await pump(w, srv.client);
        // The file is re-extracted with one more node.
        const ref = srcRef(ROOT, pathOf(0));
        const next = extraction(pathOf(0), hashOf(0, 1), 601);
        await w.store.putExtracted!(hashOf(0, 1), [next]);
        await w.store.markStale({ rootId: ROOT }, ref as never, hashOf(0, 1));
        w.sources[0] = { ref, hash: hashOf(0, 1) };
        const full = JSON.stringify([next]).length;
        await pump(w, srv.client);
        const x = srv.syncs().at(-1)!.pack!.extracted![0]!;
        expect(x.kind).toBe('diff');
        if (x.kind === 'diff') {
            expect(x.prior).toBe(hashOf(0));
            expect(x.entries[0]!.nodes.add).toHaveLength(1);
            expect(JSON.stringify(x.entries).length * 20).toBeLessThan(full);
        }
        expect(srv.s.bodies.get(hashOf(0, 1))).toEqual([next]);
    });

    it('falls back to the whole body when the server says it lacks the prior', async () => {
        const w = world();
        await w.review(0, 1, 0, 50);
        const srv = fakeServer();
        await pump(w, srv.client);
        const ref = srcRef(ROOT, pathOf(0));
        const next = extraction(pathOf(0), hashOf(0, 1), 51);
        await w.store.putExtracted!(hashOf(0, 1), [next]);
        await w.store.markStale({ rootId: ROOT }, ref as never, hashOf(0, 1));
        w.sources[0] = { ref, hash: hashOf(0, 1) };
        srv.s.failSync.push(() => Object.assign(new Error('prior'), { status: 409, code: 'prior_missing' }));
        await pump(w, srv.client);
        expect(srv.syncs().at(-1)!.pack!.extracted![0]!.kind).toBe('full');
        expect(srv.s.bodies.get(hashOf(0, 1))).toEqual([next]);
    });
});

describe('parts', () => {
    it('splits a pack over the part size into ordered parts under one syncId, and reports parts sent and left', async () => {
        const w = world();
        await w.review(0, 120, 0, 8);
        const srv = fakeServer();
        const states: ReplicaState[] = [];
        const state = await pump(w, srv.client, { maxPartBytes: 1000, newSyncId: () => 'sync-test-0001', onState: (s) => states.push(s) });
        const parts = srv.syncs();
        expect(parts.length).toBeGreaterThan(2);
        expect(parts.map((p) => p.part)).toEqual(parts.map((_, i) => i));
        expect(state.lastPack!.parts).toBe(parts.length);
        expect(states.some((s) => s.parts && s.parts.sent > 0 && s.parts.sent < s.parts.total)).toBe(true);
        expect(srv.s.files.size).toBe(120);
        expect(state.dirty).toBe(0);
    });

    it('a first sync of many files takes at most 1 + ceil(size / part) requests of sync, plus the reads', async () => {
        const w = world();
        await w.review(0, 200, 0, 4);
        const srv = fakeServer();
        const state = await pump(w, srv.client, { maxPartBytes: 4000 });
        const syncCount = srv.syncs().length;
        expect(syncCount).toBeLessThanOrEqual(1 + Math.ceil(state.lastPack!.bytes / 4000));
    });
});
