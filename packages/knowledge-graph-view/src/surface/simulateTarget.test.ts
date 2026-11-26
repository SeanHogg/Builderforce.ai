import { describe, expect, it } from 'vitest';
import type { Line } from './lines';
import { simulateTarget } from './simulateTarget';

const line = (id: string, stops: string[]): Line => ({ id, name: id, colourIndex: 0, stops, hops: [], terminus: 'end' as never, stopReason: 'end' as never });
const stations = { stationOf: new Map<string, string>([['src:r::a.ts', 'sa'], ['src:r::z.ts', 'sz']]) };

describe('simulateTarget: the path Simulate opens on for a ref', () => {
    const lines = [line('L1', ['x', 'sa']), line('L2', ['sa', 'y'])];

    it('keeps the chosen line when it passes through the ref\'s station', () => {
        expect(simulateTarget(lines, lines[1]!, stations, 'src:r::a.ts')).toEqual({ lineId: 'L2', stopId: 'sa' });
    });

    it('else takes the first line whose stops pass through it', () => {
        expect(simulateTarget(lines, line('other', ['q']), stations, 'src:r::a.ts')).toEqual({ lineId: 'L1', stopId: 'sa' });
        expect(simulateTarget(lines, null, stations, 'src:r::a.ts')).toEqual({ lineId: 'L1', stopId: 'sa' });
    });

    it('is null (the simulator opens as it did) when no line passes through, or the ref has no station', () => {
        expect(simulateTarget(lines, lines[0]!, stations, 'src:r::z.ts')).toBeNull();
        expect(simulateTarget(lines, lines[0]!, stations, 'src:r::unknown.ts')).toBeNull();
    });
});
