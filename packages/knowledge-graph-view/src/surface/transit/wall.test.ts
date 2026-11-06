import { describe, expect, it } from 'vitest';
import { nodeIndex } from '../../graphModel';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import type { HopRoute } from './corridors';
import { httpWalls, routeStations, WALL_LENGTH } from './wall';

const graph = surfaceFixture();
const model = buildStations(graph);

describe('the HTTP boundary', () => {
    it('finds the stations that serve routes', () => {
        const serving = routeStations(model.stations, nodeIndex(graph));
        expect([...serving].map((id) => model.byId.get(id)!.name)).toEqual(['API']);
    });
    it('draws a wall across the hop that enters a serving station from one that does not', () => {
        const route = (from: string, to: string): HopRoute => ({ lineId: 'l', index: 0, from, to, d: '', pts: [{ x: 0, y: 0 }, { x: 0, y: 100 }], mid: { x: 0, y: 50 } });
        const walls = httpWalls([route('web', 'api'), route('api', 'db'), route('web2', 'api')], new Set(['api']));
        expect(walls).toHaveLength(1);
        const w = walls[0]!;
        expect(w.a.y).toBe(w.b.y);
        expect(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).toBeCloseTo(WALL_LENGTH, 1);
        expect(w.a.y).toBe(66);
    });
});
