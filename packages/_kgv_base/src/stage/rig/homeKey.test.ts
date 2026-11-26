import { describe, expect, it } from 'vitest';
import type { Placement } from '../types';
import { homeKeyOf } from './useRig';

const placement = (maxY: number, view?: object): Pick<Placement, 'cacheKey' | 'bounds' | 'rig'> => ({
    cacheKey: 'g|map|||||2|0|rest|none|none|0|',
    bounds: { min: [0, 0, 0], max: [100, maxY, 50] },
    rig: { projection: 'orthographic', frame: 'document', home: { position: [0, 0, 0], target: [0, 0, 0], up: [0, 0, -1] }, depth: { tilt: [0, 60], orbit: false }, ...(view ? { view } : {}) },
} as unknown as Pick<Placement, 'cacheKey' | 'bounds' | 'rig'>);

describe('homeKeyOf (PRD 43 C4)', () => {
    it('a ground view keeps its home across a 3D / Flat switch: the extrude (bounds y) is not part of the key', () => {
        expect(homeKeyOf(placement(0))).toBe(homeKeyOf(placement(40)));
    });

    it('a ground view re-homes when its footprint changes', () => {
        const wider = placement(0);
        wider.bounds = { min: [0, 0, 0], max: [200, 0, 50] };
        expect(homeKeyOf(wider)).not.toBe(homeKeyOf(placement(0)));
    });

    it('an orbit view frames its height too', () => {
        const view = { fov: 35, distance: 10 };
        expect(homeKeyOf(placement(0, view))).not.toBe(homeKeyOf(placement(40, view)));
    });
});
