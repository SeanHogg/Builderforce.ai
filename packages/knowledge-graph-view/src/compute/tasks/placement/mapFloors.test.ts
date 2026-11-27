import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../../testing';
import { buildStageModel } from '../stageModel';
import { placeMap } from './map';
import type { PlacementReq } from './request';

describe('Map systems', () => {
    it('shows one concise label for each community segment and exposes the local file path', () => {
        const base = surfaceFixture();
        const file = (path: string, app: string) => ({
            ref: `src:sys::repo/${path}`, label: path, kind: 'file', pack: 'code', importance: 1, origin: 'extracted',
            system: 'repo', app, badges: { communityId: 9, communityConfidence: 0.9 },
        }) as KNode;
        const nodes = [file('frontend/dashboard/gauge.ts', 'frontend'), file('frontend/dashboard/tiles.ts', 'frontend'),
            file('api/actions/logs.ts', 'api'), file('api/actions/users.ts', 'api')];
        const graph: typeof base = {
            ...base, nodes, edges: [], findings: [],
            outline: { prefix: 'src:sys::', areas: [], partitions: [], files: [], links: [], capped: false,
                communities: [{ id: 9, label: 'repo/frontend/dashboard/gauge.ts', size: nodes.length }] },
        };
        const model = buildStageModel(graph);
        const map = placeMap(model, { graph: 1, generation: model.marks.generation, camera: 'map',
            viewportBand: 2, lod: 0, drill: null, unfolded: null, pins: [], pathId: null }, graph);
        expect(map.labels.map((run) => run.text).sort()).toEqual(['gauge.ts', 'logs.ts']);
        expect(map.labels.map((run) => run.chip?.title).sort()).toEqual(['repo/api/actions/logs.ts', 'repo/frontend/dashboard/gauge.ts']);
    });

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
