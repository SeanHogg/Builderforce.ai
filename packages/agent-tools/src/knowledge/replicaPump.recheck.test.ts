/**
 * The whole path for a root whose files have no stored output (a binary file reviewed before `[]` was recorded, a text file
 * not extracted yet), with NO hand-simulated review: pump → the files are held back and put on the re-check channel →
 * memory's real `reviewDirectory` (with its backfill) answers → pump settles.
 */
import { describe, expect, it } from 'vitest';
import { DOCS_PACK, filesManifestKey, localSnapshotStore, reviewDirectory, srcRef, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { pumpReplica } from './replicaPump.js';
import { fakeServer, hashOf, ROOT, world } from './replicaTestkit.test-util.js';

const FILES: Record<string, string> = { 'a.md': '# A\nalpha\n', 'blob.txt': 'bin\u0000ary' };
const hashFor = (path: string): string => hashOf(path === 'a.md' ? 91 : 92);

function source(reads: string[]): DirectorySource {
    return {
        rootId: ROOT, title: 'Fixture',
        async *list() { for (const [path, text] of Object.entries(FILES)) yield { path, hash: hashFor(path), size: text.length }; },
        async read(path: string) {
            reads.push(path);
            return { id: path, tenantId: 't', content: { kind: 'text', text: FILES[path]! } };
        },
    };
}

describe('regression: a root with files that have no stored output is settled by the next review, through the store alone', () => {
    it('regression: pump holds the files back and asks for a re-check; the real review stores an asset file node for the binary and extracts the text; the next pump settles', async () => {
        const w = world();
        const reads: string[] = [];
        const manifest = new InMemoryIngestManifest();
        // The root as it was reviewed before: the manifest names both files, but this machine's store holds no body for either.
        await reviewDirectory({ source: source([]), store: localSnapshotStore({ read: async () => undefined, write: async () => undefined }), manifest, packs: [DOCS_PACK], budget: { modelCalls: 0, ms: 60_000 } });
        for (const path of Object.keys(FILES)) {
            const ref = srcRef(ROOT, path);
            await w.store.markStale({ rootId: ROOT }, ref as never, hashFor(path));
            w.sources.push({ ref, hash: hashFor(path) });
        }
        const srv = fakeServer();
        const run = () => pumpReplica({ queue: w.queue, local: w.local, client: srv.client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });

        const stuck = await run();
        expect(stuck.failed).toEqual([]);
        expect(stuck.awaitingReview).toBe(2);
        expect(srv.s.files.size).toBe(0);
        expect(await w.local.recheckHashes!()).toEqual([hashFor('a.md'), hashFor('blob.txt')].sort());

        await reviewDirectory({ source: source(reads), store: w.local, manifest, packs: [DOCS_PACK], budget: { modelCalls: 0, ms: 60_000 } });
        // memory 2026.10.62 stores a binary file as ONE asset file node (no text claims), not `[]`.
        const blob = await w.local.getExtracted!(hashFor('blob.txt'));
        expect(blob).toHaveLength(1);
        expect(blob![0]!.edges).toEqual([]);
        expect(blob![0]!.nodes).toEqual([
            expect.objectContaining({ kind: 'file', ref: srcRef(ROOT, 'blob.txt'), sourceHash: hashFor('blob.txt'), badges: expect.objectContaining({ asset: 1 }) }),
        ]);
        expect((await w.local.getExtracted!(hashFor('a.md')))!.length).toBeGreaterThan(0);
        expect(await w.local.recheckHashes!()).toEqual([]);

        const settled = await run();
        expect(settled.failed).toEqual([]);
        expect(settled.awaitingReview).toBeUndefined();
        expect(settled.dirty).toBe(0);
        expect(new Set(srv.s.files.keys())).toEqual(new Set(Object.keys(FILES)));
    });

    it('regression: a locked file the review cannot read gets a terminal answer, so the pump stops holding it back and the root settles', async () => {
        const w = world();
        const manifest = new InMemoryIngestManifest();
        const oldHash = hashOf(93), path = 'locked.md', ref = srcRef(ROOT, path);
        await manifest.set(filesManifestKey(ROOT), [{ id: path, hash: oldHash }]); // the manifest (and so the pump) knows it at its old hash
        await w.store.markStale({ rootId: ROOT }, ref as never, oldHash);
        w.sources.push({ ref, hash: oldHash });
        const srv = fakeServer();
        const run = () => pumpReplica({ queue: w.queue, local: w.local, client: srv.client, signal: new AbortController().signal, rootId: ROOT, sources: async () => w.sources, projectId: 1 });

        expect((await run()).awaitingReview).toBe(1);
        const locked: DirectorySource = {
            rootId: ROOT, title: 'Fixture',
            async *list() { yield { path, hash: hashOf(94), size: 5 }; },
            async read() { throw new Error('EBUSY'); },
        };
        const report = await reviewDirectory({ source: locked, store: w.local, manifest, packs: [DOCS_PACK], budget: { modelCalls: 0, ms: 60_000 } });
        expect(report.readErrors).toBe(1);
        expect(await w.local.getExtracted!(oldHash)).toEqual([]);
        expect(await w.local.recheckHashes!()).toEqual([]);

        const settled = await run();
        expect(settled.failed).toEqual([]);
        expect(settled.awaitingReview).toBeUndefined();
        expect(settled.dirty).toBe(0);
        expect(srv.s.files.get(path)).toBe(oldHash);
    });
});
