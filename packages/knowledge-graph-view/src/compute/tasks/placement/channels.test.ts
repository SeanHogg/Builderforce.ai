import { describe, expect, it } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { communityKey } from '../../../placement';
import { makeOverlay, NEUTRAL_SIZE } from '../../../surface/overlays';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { layoutTransit } from '../../../surface/transitLayout';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { surfaceFixture } from '../../../testing';
import type { Placement } from '../../../stage/types';
import { buildStageModel, type StageModel } from '../stageModel';
import { PLACEMENT_WORD_KEYS } from './graph';
import { PLACEMENTS, type PlacementReq } from './index';
import { channelBindings, placementCacheKey, type PlacementChannels } from './request';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const req = (camera: PlacementReq['camera'], over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
const run = (g: KnowledgeGraph, m: StageModel, r: PlacementReq): Placement => { const t = PLACEMENTS[r.camera](g, m, r); while (!t.step()); return t.result(); };

const BOUND: PlacementChannels = { size: 'use', width: 'use' };

describe('placement channels (PRD 43 B1a rule 7): geometry from the overlay bindings, as data', () => {
    it('the fixture carries the bound readings, so the channels are live', () => {
        const status = makeOverlay(channelBindings(BOUND), model.stations.stations).status;
        expect(status.size).toBe('ready');
        expect(status.width).toBe('ready');
    });

    it('Map: a station\'s scale is its size channel and its tower height (depth 1) the SVG tower\'s reading of it', () => {
        const p = run(graph, model, req('map', { channels: BOUND, depth: 1 }));
        const overlay = makeOverlay(channelBindings(BOUND), model.stations.stations);
        const sizes = new Set<number>();
        for (const { slot } of p.a11y) {
            const s = model.stations.stations[slot - graph.nodes.length]!;
            const size = overlay.style(s).size;
            sizes.add(size);
            expect(p.scale[slot]).toBe(size);
            expect(p.extrude[slot]).toBe(towerHeight(size, s.cx));
        }
        expect(sizes.size, 'the size channel varies across the fixture').toBeGreaterThan(1);
    });

    it('Map: each route is as wide as its line\'s width channel (the SVG map\'s `lineWidth` over the line\'s stops)', () => {
        const p = run(graph, model, req('map', { channels: BOUND }));
        const overlay = makeOverlay(channelBindings(BOUND), model.stations.stations);
        const routes = layoutTransit(model.stations.stations, model.lines.lines, 960).routes;
        const byLine = new Map(model.lines.lines.map((l) => [l.id, overlay.lineWidth(l.stops.flatMap((id) => model.stations.byId.get(id) ?? []))] as const));
        const batch = p.links[0]!;
        const seen = new Set<number>();
        for (let i = 0; i < batch.group.length; i++) {
            const want = byLine.get(routes[batch.group[i]!]!.lineId)!;
            expect(batch.width[i]).toBeCloseTo(want, 5);
            seen.add(Math.round(want * 100));
        }
        expect(batch.group.length).toBeGreaterThan(0);
        expect([...seen].some((w) => w !== 600), 'a bound width differs from the neutral 6').toBe(true);
    });

    it('no channels ⇒ the neutral size, the neutral width and a tower from the complexity level', () => {
        const p = run(graph, model, req('map', { depth: 1 }));
        for (const { slot } of p.a11y) {
            const s = model.stations.stations[slot - graph.nodes.length]!;
            expect(p.scale[slot]).toBe(NEUTRAL_SIZE);
            expect(p.extrude[slot]).toBe(towerHeight(NEUTRAL_SIZE, s.cx));
        }
        for (const w of p.links[0]!.width) expect(w).toBe(6);
    });

    it('the bindings are part of the cache key (a different size or width is a different layout)', () => {
        const flat = placementCacheKey('d', req('map'));
        expect(placementCacheKey('d', req('map', { channels: BOUND }))).not.toBe(flat);
        expect(placementCacheKey('d', req('map', { channels: { size: 'use', width: 'none' } }))).not.toBe(placementCacheKey('d', req('map', { channels: BOUND })));
        expect(placementCacheKey('d', req('map', { channels: { size: 'none', width: 'none' } }))).toBe(flat);
    });
});

describe('Graph captions: a band\'s placement key read through placementLabel', () => {
    /** The fixture with its partitions dropped: some files share community 7, the rest have no placement at all. */
    function communityGraph(): KnowledgeGraph {
        let k = 0;
        const nodes = graph.nodes.map((n): KNode => {
            if (n.kind !== 'file') return n;
            const { partition: _drop, ...rest } = n;
            return k++ % 2 === 0 ? { ...rest, badges: { ...(n.badges ?? {}), communityId: 7 } } : rest;
        });
        return { ...graph, nodes };
    }

    it('names a community band by its label (else the localized fallback) and the empty key by partitionNone — never the raw key', () => {
        const g = communityGraph();
        const strings = Object.fromEntries(PLACEMENT_WORD_KEYS.map((key) => [key, L[key]]));
        const m = buildStageModel(g, [], strings);
        const p = run(g, m, req('graph', { generation: m.marks.generation }));
        const texts = p.captions.map((c) => c.text);
        expect(texts).toContain(L.partitionNone);
        for (const t of texts) {
            expect(t.startsWith('community:'), t).toBe(false);
            expect(t).not.toBe('');
        }
        expect(texts.some((t) => t !== L.partitionNone), `a community band: ${texts.join(', ')}`).toBe(true);
        expect(communityKey(7)).toBe('community:7');
    });

    it('with no words carried, a missing word reads empty rather than the raw key', () => {
        const g = communityGraph();
        const m = buildStageModel(g, []);
        const p = run(g, m, req('graph', { generation: m.marks.generation }));
        for (const c of p.captions) expect(c.text.startsWith('community:'), c.text).toBe(false);
    });
});
