import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { bandStrings, bandTitle } from '../../../surface/bands';
import { surfaceFixture } from '../../../testing';
import { buildStageModel } from '../stageModel';
import { placeMap } from './map';
import type { PlacementReq } from './request';

const graph = surfaceFixture();
const req = (generation: number): PlacementReq => ({ graph: 1, generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });

describe('Map band captions are the localized band titles (sent as strings: the worker has no labels)', () => {
    it('reads each band\'s title from the markSet strings, as the SVG map titles it', () => {
        const model = buildStageModel(graph, [], bandStrings(L));
        const p = placeMap(model, req(model.marks.generation));
        expect(p.captions.length).toBeGreaterThan(0);
        for (const c of p.captions) expect(Object.keys(L.surface.layers).map((layer) => bandTitle(layer, L))).toContain(c.text);
        // Not the raw layer id (the ids are lower-case words like `domain`; the titles are the catalog's).
        expect(p.captions.some((c) => c.text !== c.text.toLowerCase())).toBe(true);
    });

    it('falls back to the layer id only when the host sent no title', () => {
        const model = buildStageModel(graph, []);
        const p = placeMap(model, req(model.marks.generation));
        expect(p.captions.length).toBeGreaterThan(0);
        for (const c of p.captions) expect(Object.keys(L.surface.layers)).toContain(c.text);
    });
});
