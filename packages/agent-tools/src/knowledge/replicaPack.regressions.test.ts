/**
 * Regressions of the pack builder and the pump around it: a refused fact is never a tombstone, a root id ending in ':' keeps
 * its paths whole, a halving retry asks the server nothing twice, and a 413 cut does not throttle the rest of the run.
 */
import { describe, expect, it } from 'vitest';
import { localSnapshotStore, srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { decodePack, fileLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
import { buildPack, type PackQueries } from './replicaPack.js';
import { pumpReplica, type ReplicaClient } from './replicaPump.js';
import { createReplicaQueue, memoryReplicaPersistence } from './replicaQueue.js';
import { apiError, extraction, factKey, factOf, fakeServer, hashOf, pathOf, ROOT, scope, world, type World } from './replicaTestkit.test-util.js';

const pump = (w: World, client: ReplicaClient) =>
    pumpReplica({ queue: w.queue, local: w.local, client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });

describe('a fact refused for its content', () => {
    it('regression: a fact the server holds, edited to hold a NUL, is skipped and reported — never tombstoned', async () => {
        const w = world();
        await w.review(0, 2); // writes fact claim:0
        const srv = fakeServer();
        expect((await pump(w, srv.client)).failed).toEqual([]);
        expect(srv.s.facts.has('claim:0')).toBe(true);

        await w.store.write({ scope, facts: [{ ...factOf('claim:0', pathOf(0)), content: 'bad\u0000content' }], relations: [] });
        expect((await w.queue.snapshot()).keys).toContain(factKey('claim:0'));
        const state = await pump(w, srv.client);

        for (const sync of srv.syncs()) expect(sync.pack?.deletes?.facts ?? []).not.toContain('claim:0');
        expect(srv.s.facts.has('claim:0')).toBe(true);
        expect(srv.s.leaves.has(factKey('claim:0'))).toBe(true);
        expect(state.failed.some((f) => /fact .*claim:0/.test(f.reason))).toBe(true);
    });
});

/** A one-file root whose id ends in ':' (the linked repo's `cloud:<id>:`), with its own local store and a server that holds nothing. */
async function trailingColonRoot() {
    const rootId = 'cloud:5:', path = 'docs/a.md', hash = hashOf(1000);
    let text: string | undefined;
    const local = localSnapshotStore({ read: async () => text, write: async (t) => { text = t; } });
    await local.putExtracted!(hash, [{ ...extraction(path, hash), sourceRef: srcRef(rootId, path) }]);
    const client: PackQueries = { syncHave: async (_r, pairs) => pairs.map(() => false), syncLeaves: async () => ({ generation: 0, leaves: [] }) };
    return { rootId, path, hash, local, client };
}

describe('a root id ending in ":"', () => {
    it('regression: the pack carries the WHOLE path and the stat-cache size (a first-`::` cut sent `:docs/a.md` and bytes 0)', async () => {
        const { rootId, path, hash, local, client } = await trailingColonRoot();
        const ref = srcRef(rootId, path);
        expect(ref).toBe('src:cloud:5:::docs/a.md');
        const built = await buildPack({ rootId, local, client, sources: [{ ref, hash, bytes: 42 }], touched: [fileLeafKey(path, hash)], baseGeneration: 0 });
        const pack = await decodePack(built.bytes);
        expect(pack.files).toEqual([{ path, hash, bytes: 42 }]);
        expect(built.sentKeys).toEqual([fileLeafKey(path, hash)]);
    });

    it('regression: an old op log naming such a root converts to the whole path', async () => {
        const oldLog = JSON.stringify({ version: 1, ops: [{ op: 'markStale', rootId: 'cloud:5:', sourceRef: 'src:cloud:5:::docs/a.md', hash: 'h1' }] });
        const queue = createReplicaQueue(memoryReplicaPersistence(), { legacy: { read: async () => oldLog, remove: async () => undefined } });
        expect((await queue.snapshot()).keys).toEqual([fileLeafKey('docs/a.md', '')]);
    });
});

describe('halving retries', () => {
    it('regression: a pack cut repeatedly asks syncHave and syncLeaves, and reads each body, only once', async () => {
        const w = world();
        await w.review(0, 40, 0, 6);
        const srv = fakeServer();
        let have = 0, leaves = 0;
        const reads = new Map<string, number>();
        const local = { ...w.local, getExtracted: async (h: string) => { reads.set(h, (reads.get(h) ?? 0) + 1); return w.local.getExtracted!(h); } };
        const client: PackQueries = {
            syncHave: async (r, p) => { have += 1; return srv.client.syncHave(r, p); },
            syncLeaves: async (r, b) => { leaves += 1; return srv.client.syncLeaves(r, b); },
        };
        const base = { rootId: ROOT, local, sources: w.sources, client, touched: (await w.queue.snapshot()).keys, baseGeneration: 0 };
        const whole = await buildPack(base);
        have = 0; leaves = 0; reads.clear();
        const built = await buildPack({ ...base, maxDecodedBytes: Math.floor(whole.decodedBytes / 8) });
        expect(built.final).toBe(false);
        expect(built.files).toBeLessThan(10); // cut at least twice
        expect(have).toBeLessThanOrEqual(1);
        expect(leaves).toBeLessThanOrEqual(1);
        expect([...reads.values()].every((n) => n === 1)).toBe(true);
    });
});

describe('a 413 cut', () => {
    it('regression: maxFiles grows back after a cut lands, so the rest of the run is not throttled', async () => {
        const w = world();
        await w.review(0, 32);
        const srv = fakeServer();
        for (let i = 0; i < 3; i++) srv.s.failSync.push(() => apiError(413, { code: 'pack_too_large' })); // 32 → 16 → 8 → 4
        const state = await pump(w, srv.client);
        expect(state.failed).toEqual([]);
        expect(state.dirty).toBe(0);
        expect(srv.s.files.size).toBe(32);
        // 4 lands, then 8, then 16, then the last 4 (and the rows): never 8 packs of 4.
        expect(srv.syncs().map((s) => s.pack?.files?.length ?? 0)).toEqual([4, 8, 16, 4]);
    });
});
