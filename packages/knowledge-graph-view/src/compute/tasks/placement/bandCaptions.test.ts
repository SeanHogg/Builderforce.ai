import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { bandStrings, bandTitle } from '../../../surface/bands';
import { surfaceFixture } from '../../../testing';
import { ComputeStore } from '../../store';
import { buildStageModel, stageModelOf } from '../stageModel';
import { placeMap } from './map';
import { placeSystem } from './system';
import type { PlacementReq } from './request';

const graph = surfaceFixture();
const req = (generation: number, camera: PlacementReq['camera'] = 'system'): PlacementReq => ({ graph: 1, generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });

// The System camera also has rows that are not layers (Data, Units, "loose"): their words travel in `cameraStrings`, which these requests do not send, so they
// caption as ''. Only the layer bands (the ones `bandStrings` titles) are under test here.
const layerBands = (captions: readonly { role?: string; text: string }[]) => captions.filter((c) => c.role === 'band' && c.text !== '');

describe("the Layers camera's band captions are the localized band titles (sent as strings: the worker has no labels)", () => {
    it('draws NO band captions on the perspective Map (the design has none; a ground caption drifts under a tilted camera)', () => {
        const model = buildStageModel(graph, bandStrings(L));
        expect(placeMap(model, req(model.marks.generation, 'map')).captions).toEqual([]);
    });

    it('reads each band\'s title from the markSet strings, as the SVG map titles it', () => {
        const model = buildStageModel(graph, bandStrings(L));
        const p = placeSystem(graph, model, req(model.marks.generation));
        const titles = Object.keys(L.surface.layers).map((layer) => bandTitle(layer, L));
        const bands = layerBands(p.captions);
        expect(bands.length).toBeGreaterThan(0);
        for (const c of bands) expect(titles).toContain(c.text);
        // Not the raw layer id (the ids are lower-case words like `domain`; the titles are the catalog's).
        expect(bands.some((c) => c.text !== c.text.toLowerCase())).toBe(true);
    });

    it('a locale switch re-localizes the held model: a new MarkSet build (generation, digest) whose captions are the new titles', () => {
        const store = new ComputeStore();
        store.adopt(1, graph);
        const english = bandStrings(L);
        const other = Object.fromEntries(Object.entries(english).map(([k, v]) => [k, `«${v}»`]));
        const a = stageModelOf(store, 1, english);
        expect(stageModelOf(store, 1, english)).toBe(a);            // the same strings: the model is held
        expect(stageModelOf(store, 1)).toBe(a);                         // paint / placement read the held one
        const b = stageModelOf(store, 1, other);
        expect(b).not.toBe(a);
        expect(b.marks.generation).not.toBe(a.marks.generation);
        expect(b.marks.digest).not.toBe(a.marks.digest);
        const captions = layerBands(placeSystem(graph, b, req(b.marks.generation)).captions).map((c) => c.text);
        expect(captions.length).toBeGreaterThan(0);
        for (const t of captions) expect(t.startsWith('«')).toBe(true);
    });

    it('falls back to the layer id only when the host sent no title', () => {
        const model = buildStageModel(graph);
        const p = placeSystem(graph, model, req(model.marks.generation));
        const bands = layerBands(p.captions);
        expect(bands.length).toBeGreaterThan(0);
        for (const c of bands) expect(Object.keys(L.surface.layers)).toContain(c.text);
    });
});
