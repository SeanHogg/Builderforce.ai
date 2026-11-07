import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { buildStations } from './stations';
import { buildTiers, findingKinds } from './tiers';

const graph = surfaceFixture();
const model = buildStations(graph);

describe('buildTiers', () => {
    it('groups the stations in layer order, busiest first', () => {
        const tiers = buildTiers(model.stations);
        expect(tiers.map((t) => t.layer)).toEqual(['entry', 'presentation', 'infrastructure']);
        expect(tiers[0]!.stations.map((s) => s.name).sort()).toEqual(['cron', 'main.tsx']);
        const uses = tiers.flatMap((t) => t.stations.map((s) => s.use));
        expect(uses.length).toBe(model.stations.length);
    });

    it('puts a station with no known layer in "other", last', () => {
        const odd = { ...model.stations[0]!, id: 'odd', layer: 'weird' };
        expect(buildTiers([...model.stations, odd]).at(-1)!.layer).toBe('other');
    });
});

describe('findingKinds', () => {
    it('counts a station\'s findings by kind', () => {
        const byId = new Map(graph.findings.map((f) => [f.id, f] as const));
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(findingKinds(api, byId)).toEqual([{ kind: 'clone-group', count: 1 }, { kind: 'partition-violation', count: 1 }]);
        expect(findingKinds({ findingIds: ['gone'] }, byId)).toEqual([]);
    });
});
