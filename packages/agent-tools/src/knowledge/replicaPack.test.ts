/**
 * The pack builder cuts a pack by its DECODED size and its rows, not only by file count (PRD 41 A11 rule 4b): a
 * pack that would pass what the server inflates is cut before the server has to refuse it.
 */
import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { decodePack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { buildPack } from './replicaPack.js';
import { knowledgeMeasuredWith } from './measuredWith.js';
import { extraction, fakeServer, hashOf, ROOT, world, type World } from './replicaTestkit.test-util.js';

async function setup(files: number) {
    const w = world();
    await w.review(0, files, 0, 6);
    const srv = fakeServer();
    const touched = (await w.queue.snapshot()).keys;
    const base = { rootId: ROOT, local: w.local, sources: w.sources, client: srv.client, touched, baseGeneration: 0 };
    return { w, base };
}

describe('buildPack cuts by decoded size and rows', () => {
    it('one pack when it fits', async () => {
        const { base } = await setup(60);
        const built = await buildPack(base);
        expect(built.final).toBe(true);
        expect(built.files).toBe(60);
        expect(built.decodedBytes).toBeGreaterThan(0);
    });

    it('is cut in half, repeatedly, until its decoded body fits the cap; the rest stay dirty and the slice asserts no digest', async () => {
        const { base } = await setup(60);
        const whole = await buildPack(base);
        const cap = Math.floor(whole.decodedBytes / 4);
        const built = await buildPack({ ...base, maxDecodedBytes: cap });
        expect(built.final).toBe(false);
        expect(built.files).toBeLessThan(60);
        expect(built.files).toBeGreaterThan(0);
        expect(built.decodedBytes).toBeLessThanOrEqual(cap);
        expect(built.sentKeys.length).toBe(built.files);
        expect(built.sentKeys.every((k) => k.startsWith('f:'))).toBe(true);
    });

    it('is cut by rows too: many small rows are as heavy as a few large ones', async () => {
        const { base } = await setup(60);
        const built = await buildPack({ ...base, maxRows: 200 });
        expect(built.final).toBe(false);
        expect(built.files).toBeLessThan(60);
    });

    it('never cuts below one file: a single file that is over the cap goes alone and the server decides', async () => {
        const { base } = await setup(5);
        const built = await buildPack({ ...base, maxDecodedBytes: 10 });
        expect(built.files).toBe(1);
        expect(built.final).toBe(false);
    });
});

describe('what the review was measured with (PRD 41 §C9)', () => {
    it('goes with a pack whose scope records the review digest, and with no other', async () => {
        const { w, base } = await setup(4);
        expect((await buildPack(base)).measured).toBeUndefined();
        await w.local.write({ scope: { rootId: ROOT, title: 'test', packs: ['code'], lastDigest: 'abcdef12' }, facts: [], relations: [] });
        const built = await buildPack(base);
        await expect(decodePack(built.bytes)).resolves.toMatchObject({ scope: { lastDigest: 'abcdef12' } });
        expect(built.measured).toEqual(knowledgeMeasuredWith(['code']));
        expect(built.measured!.toolVersions).toMatchObject({ knip: expect.any(String), jscpd: expect.any(String), 'dependency-cruiser': expect.any(String) });
    });
});

describe('holds are decided BEFORE slicing', () => {
    it('regression: a cut pack (maxFiles) never ships a file with no body: more absent files than the limit are all held back', async () => {
        const w = world();
        await w.review(0, 12);
        const absent: string[] = [];
        for (let i = 0; i < 12; i++) {
            const hash = hashOf(1000 + i), path = `data/locked${i}.bin`, ref = srcRef(ROOT, path); // (1000+: hashOf pads with "c", so small ids collide with hex ones)
            await w.store.markStale({ rootId: ROOT }, ref as never, hash); // a hash, no body, and the project does not hold it
            w.sources.push({ ref, hash });
            absent.push(path);
        }
        const touched = (await w.queue.snapshot()).keys;
        const base = { rootId: ROOT, local: w.local, sources: w.sources, client: fakeServer().client, touched, baseGeneration: 0 };
        for (const maxFiles of [5, 3, 1]) {
            const built = await buildPack({ ...base, maxFiles });
            const pack = await decodePack(built.bytes);
            expect(built.waiting).toBe(12); // root-wide, however the pack is cut
            expect((pack.files ?? []).every((f) => !absent.includes(f.path))).toBe(true);
            expect(built.sentKeys.some((k) => absent.some((p) => k.startsWith(`f:${p}`)))).toBe(false);
        }
    });

    it('regression: a file the project already holds for its pair is never held back, whatever the local store lacks', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(230), path = 'src/held.ts', ref = srcRef(ROOT, path);
        await w.store.markStale({ rootId: ROOT }, ref as never, hash);
        w.sources.push({ ref, hash });
        const srv = fakeServer();
        srv.s.bodies.set(hash, [extraction(path, hash)]); // the project holds the pair
        const built = await buildPack({ rootId: ROOT, local: w.local, sources: w.sources, client: srv.client, touched: (await w.queue.snapshot()).keys, baseGeneration: 0 });
        expect(built.waiting).toBe(0);
        expect((await decodePack(built.bytes)).files?.some((f) => f.path === path)).toBe(true);
    });
});

describe('what the store says about a source\'s extracted output', () => {
    const stale = async (w: World, path: string, hash: string): Promise<void> => {
        const ref = srcRef(ROOT, path);
        await w.store.markStale({ rootId: ROOT }, ref as never, hash);
        w.sources.push({ ref, hash });
    };
    const packFor = async (w: World, extra: { forceBodies?: ReadonlySet<string> } = {}) =>
        decodePack((await buildPack({ rootId: ROOT, local: w.local, sources: w.sources, client: fakeServer().client, touched: (await w.queue.snapshot()).keys, baseGeneration: 0, ...extra })).bytes);

    it('regression: an explicit stored [] (the review recorded a binary file) ships as an explicit empty full body', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(70);
        await w.store.putExtracted!(hash, []);
        await stale(w, 'assets/logo.png', hash);
        expect((await packFor(w)).extracted?.find((x) => x.hash === hash)).toEqual({ kind: 'full', hash, entries: [] });
    });

    it('regression: the explicit empty body also goes when forceBodies names it (the server answered extracted_missing)', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(71);
        await w.store.putExtracted!(hash, []);
        await stale(w, 'assets/icon.png', hash);
        expect((await packFor(w, { forceBodies: new Set([hash]) })).extracted?.find((x) => x.hash === hash)).toEqual({ kind: 'full', hash, entries: [] });
    });

    it('regression: a text file staled before its body is stored sends NO empty body; its real body goes once extracted', async () => {
        const w = world();
        await w.review(0, 2);
        const hash = hashOf(72), path = 'src/pending.ts';
        await stale(w, path, hash); // as markFilesEdited does, before extractFile
        expect((await packFor(w)).extracted?.some((x) => x.hash === hash)).toBe(false);
        expect((await packFor(w, { forceBodies: new Set([hash]) })).extracted?.some((x) => x.hash === hash)).toBe(false);

        await w.store.putExtracted!(hash, [extraction(path, hash)]); // the extraction lands
        const body = (await packFor(w)).extracted?.find((x) => x.hash === hash);
        expect(body?.kind === 'full' && body.entries.length).toBe(1);
    });
});

