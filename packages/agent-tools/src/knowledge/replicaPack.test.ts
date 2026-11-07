/**
 * The pack builder cuts a pack by its DECODED size and its rows, not only by file count (PRD 41 A11 rule 4b): a
 * pack that would pass what the server inflates is cut before the server has to refuse it.
 */
import { describe, expect, it } from 'vitest';
import { buildPack } from './replicaPack.js';
import { fakeServer, ROOT, world } from './replicaTestkit.test-util.js';

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
