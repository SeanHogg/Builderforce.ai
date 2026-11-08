import { describe, expect, it } from 'vitest';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { analysisManifestKey, reviewPacks } from './reviewRunner.js';
import { landingManifest } from './landingManifest.js';

function recording(): { manifest: IngestManifest; events: string[] } {
    const data = new Map<string, Array<{ id: string; hash: string }>>();
    const events: string[] = [];
    return {
        events,
        manifest: {
            get: async (k) => data.get(k),
            set: async (k, v) => { events.push(`manifest.set ${k}`); data.set(k, v); },
            delete: async (k) => { data.delete(k); },
        },
    };
}

const ex = { sourceRef: 'src:r::a.ts', sourceHash: 'h1', nodes: [], edges: [], keys: [] };

describe('the analysis manifest entry lands after the analyzer outputs are stored', () => {
    it('is held when `analyse` returns and committed just before the review\'s next manifest write', async () => {
        const { manifest, events } = recording();
        const landing = landingManifest(manifest);
        const packs = reviewPacks({ analyzers: { analyse: async () => [ex as never] } }, landing);
        const analyzers = packs.find((p) => p.analyzers)!.analyzers!;

        await analyzers.analyse('r');
        events.push('store.putExtracted'); // the review stores what `analyse` returned
        expect(events).toEqual(['store.putExtracted']); // nothing committed ahead of the facts
        expect(await landing.get(analysisManifestKey('r'))).toEqual(expect.arrayContaining([{ id: 'src:r::a.ts', hash: 'h1' }])); // read through the hold

        await landing.set('knowledge:r', [{ id: 'a.ts', hash: 'h1' }]); // the review's own write, after its facts are durable
        expect(events).toEqual(['store.putExtracted', `manifest.set ${analysisManifestKey('r')}`, 'manifest.set knowledge:r']);
    });

    it('an aborted run (no manifest write) drops the held entry, so the manifest is never ahead', async () => {
        const { manifest, events } = recording();
        const landing = landingManifest(manifest);
        landing.hold('k', [{ id: 'a', hash: '1' }]);
        expect(events).toEqual([]);
        expect(await manifest.get('k')).toBeUndefined();
    });
});
