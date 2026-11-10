import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { bandStrings, bandTitle } from '../../../surface/bands';
import { surfaceFixture } from '../../../testing';
import { ComputeStore } from '../../store';
import { buildStageModel, stageModelOf } from '../stageModel';
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

    it('a locale switch re-localizes the held model: a new MarkSet build (generation, digest) whose captions are the new titles', () => {
        const store = new ComputeStore();
        store.adopt(1, graph);
        const english = bandStrings(L);
        const other = Object.fromEntries(Object.entries(english).map(([k, v]) => [k, `«${v}»`]));
        const a = stageModelOf(store, 1, [], english);
        expect(stageModelOf(store, 1, [], english)).toBe(a);            // the same strings: the model is held
        expect(stageModelOf(store, 1)).toBe(a);                         // paint / placement read the held one
        const b = stageModelOf(store, 1, [], other);
        expect(b).not.toBe(a);
        expect(b.marks.generation).not.toBe(a.marks.generation);
        expect(b.marks.digest).not.toBe(a.marks.digest);
        const captions = placeMap(b, req(b.marks.generation)).captions.map((c) => c.text);
        expect(captions.length).toBeGreaterThan(0);
        for (const t of captions) expect(t.startsWith('«')).toBe(true);
    });

    it('falls back to the layer id only when the host sent no title', () => {
        const model = buildStageModel(graph, []);
        const p = placeMap(model, req(model.marks.generation));
        expect(p.captions.length).toBeGreaterThan(0);
        for (const c of p.captions) expect(Object.keys(L.surface.layers)).toContain(c.text);
    });
});
