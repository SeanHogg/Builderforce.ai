/**
 * The pump's two protections against a pack the server will not take (PRD 41 A11 rule 4b): a `409 body_conflict` is
 * rebuilt and resent at most 3 times and then recorded, and a path or key holding a control character is left out of the
 * pack (the server answers 422 for it) and recorded, instead of stalling the pump.
 */
import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { ZERO_DIGEST } from '@seanhogg/builderforce-memory/knowledge/pack';
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

describe('a pack past the server\'s total byte cap', () => {
    it('is cut in half by files before it is sent, and every file still lands', async () => {
        const w = world();
        await w.review(0, 40, 0, 4);
        const srv = fakeServer();
        const state = await pumpReplica({
            queue: w.queue, local: w.local, client: srv.client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1,
            maxPackBytes: 400, // the 40-file pack deflates to well over this, but a pack of ~10 files does not: it must be halved, not sent whole
        });
        expect(state.failed).toEqual([]);
        expect(srv.syncs().length).toBeGreaterThan(1);
        expect(srv.syncs()[0]!.pack!.files!.length).toBeLessThan(40); // the whole set was never sent: it was halved first
        expect(srv.s.files.size).toBe(40);
        expect(state.dirty).toBe(0);
    });
});

describe('a lone surrogate or a NUL in a path, key or fact text', () => {
    it('is left out of the pack like a control character, and the rest lands', async () => {
        const w = world();
        await w.review(0, 3);
        const hash = hashOf(91), path = 'src/lone\uD800.ts', ref = srcRef(ROOT, path);
        await w.store.putExtracted!(hash, [extraction(path, hash)]);
        await w.store.markStale({ rootId: ROOT }, ref as never, hash);
        w.sources.push({ ref, hash });
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        expect(srv.syncs()[0]!.pack!.files?.map((f) => f.path)).toEqual([pathOf(0), pathOf(1), pathOf(2)]);
        expect(state.failed).toHaveLength(1);
        expect(state.dirty).toBe(0);
    });
});

describe('a file whose extracted output is not there (a binary file the review never recorded, an unreadable file)', () => {
    const addFile = async (w: World, path: string, hash: string, body?: Parameters<NonNullable<World['store']['putExtracted']>>[1]): Promise<void> => {
        const ref = srcRef(ROOT, path);
        if (body) await w.store.putExtracted!(hash, body);
        await w.store.markStale({ rootId: ROOT }, ref as never, hash);
        w.sources.push({ ref, hash });
    };

    it('regression: one file with no body among 50 good ones: the 50 land, the 1 stays dirty, no 409 loop, and the count is reported', async () => {
        const w = world();
        await w.review(0, 50);
        const hash = hashOf(80), path = 'data/locked.bin';
        await addFile(w, path, hash);
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        expect(srv.s.files.size).toBe(50);
        expect(srv.s.files.has(path)).toBe(false);
        expect(state.failed).toEqual([]);
        expect(state.awaitingReview).toBe(1);
        expect(state.dirty).toBe(1); // only the held-back file: the rows, scope and facts were carried by the same pack
        expect(srv.s.facts.size).toBe(25);
        expect(srv.syncs()).toHaveLength(1); // one pack, no extracted_missing round trips
        expect(srv.syncs()[0]!.pack!.files?.some((f) => f.path === path)).toBe(false);
        expect(srv.syncs()[0]!.pack!.targetDigest).toBe(ZERO_DIGEST); // a slice: it asserts no digest
    });

    it('regression: halving a big first sync by size never lets a held-back file slip into a slice: failed stays empty and no conflict loop', async () => {
        const w = world();
        await w.review(0, 40, 0, 4);
        for (let i = 0; i < 6; i++) await addFile(w, `data/locked${i}.bin`, hashOf(300 + i));
        const srv = fakeServer();
        const state = await pumpReplica({
            queue: w.queue, local: w.local, client: srv.client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1,
            maxPackBytes: 400,
        });
        expect(state.failed).toEqual([]);
        expect(srv.s.files.size).toBe(40);
        expect(state.awaitingReview).toBe(6);
        expect(srv.syncs().every((s) => (s.pack?.files ?? []).every((f) => !f.path.startsWith('data/locked')))).toBe(true);
    });

    it('regression: a pending analysis snapshot ships even when every remaining file is held back', async () => {
        const w = world();
        const hash = hashOf(310), path = 'data/locked.bin';
        await addFile(w, path, hash);
        w.queue.setAnalysis({ sha: 'abc123', snapshot: { nodes: [] } });
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.awaitingReview).toBe(1);
        expect(srv.syncs().some((s) => (s.pack?.analysis as { sha?: string } | undefined)?.sha === 'abc123')).toBe(true);
        expect((await w.queue.snapshot()).analysis).toBeUndefined();
    });

    it('regression: the held-back file\'s hash is put on the re-check channel (and only that one)', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(82);
        await addFile(w, 'data/blob.dat', hash);
        await pump(w, fakeServer().client);
        expect(await w.local.recheckHashes!()).toEqual([hash]);
    });

    it('regression: with an explicit stored [] the file is not held back: the empty body ships, lands first time, and the root settles', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(81), path = 'assets/photo.png';
        await addFile(w, path, hash, []);
        const srv = fakeServer();
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.awaitingReview).toBeUndefined();
        expect(state.dirty).toBe(0);
        expect(srv.syncs()).toHaveLength(1);
        expect(srv.syncs()[0]!.pack!.extracted?.find((x) => x.hash === hash)).toEqual({ kind: 'full', hash, entries: [] });
        expect(srv.s.files.get(path)).toBe(hash);
    });
});

