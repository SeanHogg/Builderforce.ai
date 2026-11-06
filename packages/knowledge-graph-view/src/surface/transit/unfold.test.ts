import { describe, expect, it } from 'vitest';
import { nodeIndex } from '../../graphModel';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { satellitePlaces, satellitesOf } from './unfold';

const graph = surfaceFixture();
const model = buildStations(graph);
const index = nodeIndex(graph);
const station = (name: string) => model.stations.find((s) => s.name === name)!;

describe('satellitesOf', () => {
    it('falls back to the top files when the files share one folder, most important first', () => {
        expect(satellitesOf(station('API'), index).map((s) => s.name)).toEqual(['useCase.ts', 'routes.ts']);
    });
    it('opens into sub-areas when the files spread over folders', () => {
        const spread = { refs: ['src:sys::a/x/1.ts', 'src:sys::a/x/2.ts', 'src:sys::a/y/3.ts'] };
        const idx = new Map(spread.refs.map((r, i) => [r, { importance: i === 2 ? 0.9 : 0.1 }] as const)) as never;
        expect(satellitesOf(spread, idx).map((s) => s.name)).toEqual(['y', 'x']);
    });
    it('has nothing to open for a single file', () => {
        expect(satellitesOf(station('main.tsx'), index)).toEqual([]);
    });
    it('caps the satellites', () => {
        const refs = Array.from({ length: 12 }, (_, i) => `src:sys::z/f${i}.ts`);
        expect(satellitesOf({ refs }, new Map() as never)).toHaveLength(6);
    });
});

describe('satellitePlaces', () => {
    it('spreads them on an arc below the station, or above in the lower half', () => {
        const below = satellitePlaces({ x: 100, y: 100 }, 3, false), above = satellitePlaces({ x: 100, y: 100 }, 3, true);
        expect(below.every((p) => p.y > 100)).toBe(true);
        expect(above.every((p) => p.y < 100)).toBe(true);
        expect(below[0]!.anchor).toBe('start');
        expect(below[2]!.anchor).toBe('end');
    });
});
