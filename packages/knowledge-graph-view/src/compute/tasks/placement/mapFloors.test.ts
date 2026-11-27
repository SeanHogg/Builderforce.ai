import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../../testing';
import { buildStageModel } from '../stageModel';
import { placeMap } from './map';
import type { PlacementReq } from './request';

describe('Map systems', () => {
    it('places separate bases and removes a hidden system without changing mark identities', () => {
        const fixture = surfaceFixture();
        const nodes = fixture.nodes.map((node) => node.kind === 'file'
            ? { ...node, system: node.ref.includes('web/') ? 'web' : 'backend' } : node);
        const graph = { ...fixture, nodes };
        const model = buildStageModel(graph);
        const request: PlacementReq = {
            graph: 1, generation: model.marks.generation, camera: 'map',
            viewportBand: 2, lod: 0, drill: null, unfolded: null, pins: [], pathId: null,
        };
        const map = placeMap(model, request, graph);
        expect(map.planes).toHaveLength(2);
        expect(map.planes[1]!.min[2]).toBeGreaterThan(map.planes[0]!.max[2]);
        const hiddenStations = model.stations.stations.filter((station) => station.system === 'web').map((station) => station.id);
        const filtered = placeMap(model, { ...request, hiddenStations }, graph);
        expect(filtered.planes).toHaveLength(1);
        expect(filtered.cacheKey).not.toBe(map.cacheKey);
        expect(filtered.scale).toHaveLength(map.scale.length);
        for (const id of hiddenStations) expect(filtered.scale[model.stationSlot.get(id)!]).toBe(0);
        const empty = placeMap(model, { ...request, hiddenStations: model.stations.stations.map((station) => station.id) }, graph);
        expect(empty.planes).toHaveLength(0);
        expect(empty.a11y).toHaveLength(0);
    });
});
