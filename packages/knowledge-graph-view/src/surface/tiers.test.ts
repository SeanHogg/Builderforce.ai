import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { buildStations } from './stations';
import { buildTiers } from './tiers';

const model = buildStations(surfaceFixture());

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
