import { describe, expect, it } from 'vitest';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { filesManifestKey, localSnapshotStore } from '@seanhogg/builderforce-memory/knowledge';
import { buildStoredGraph } from './reviewRunner.js';

/**
 * `buildStoredGraph` runs on the VS Code extension host, which is ALSO the webview
 * bridge. Each per-file extract read resolves synchronously (node:sqlite + a cached
 * parse), so without an explicit macrotask the whole walk drains only microtasks and
 * starves pending bridge work — the webview sees "Request timed out". The
 * `yieldEvery`/`yieldDelay` seam hands the loop back to the event loop every N files.
 */
describe('buildStoredGraph event-loop yield seam', () => {
    const MANY = 600;

    const setupFiles = (): Record<string, string> => {
        const files: Record<string, string> = {};
        for (let i = 0; i < MANY; i++) files[`f${i}.md`] = `# Doc ${i}\n\nsome content ${i}\n`;
        return files;
    };

    const setup = () => {
        const manifest = new InMemoryIngestManifest();
        const snapshotStore = localSnapshotStore({ read: async () => undefined, write: async () => undefined });
        return { manifest, store: snapshotStore };
    };

    it('yields the event loop every `yieldEvery` files while reading extracts', async () => {
        const { manifest, store } = setup();
        // Seed the reviewed-hash manifest so `storedFileHashes` sees every file.
        await manifest.set(filesManifestKey('big'), Object.keys(setupFiles()).map((id) => ({ id, hash: `h:${id}` })));

        let yields = 0;
        const yieldDelay = () => { yields += 1; return Promise.resolve(); };

        await buildStoredGraph({
            rootId: 'big',
            store,
            manifest,
            packs: [],
            yieldEvery: 100,
            yieldDelay,
        });

        // 600 files ÷ every 100 → 6 yields. The count is what proves the loop hands the
        // event loop a macrotask on schedule, not just once at the end.
        expect(yields).toBe(6);
    });

    it('does not yield when the seam is absent (library default, non-UI hosts)', async () => {
        const { manifest, store } = setup();
        await manifest.set(filesManifestKey('big'), Object.keys(setupFiles()).map((id) => ({ id, hash: `h:${id}` })));

        let yields = 0;
        await buildStoredGraph({
            rootId: 'big',
            store,
            manifest,
            packs: [],
            yieldDelay: () => { yields += 1; return Promise.resolve(); },
        });
        expect(yields).toBe(0);
    });
});
