import { describe, expect, it } from 'vitest';
import type { NestBasis } from '../drill/nest';
import { holdsForNestBasis } from './useNestBasis';

const basis = { marks: { generation: 2, keys: [] }, levels: [] } as NestBasis;

describe('holdsForNestBasis', () => {
    it('holds while the placements compute, or landed and are not yet taken, and the level awaits them', () => {
        expect(holdsForNestBasis(true, null, true)).toBe(true);
        expect(holdsForNestBasis(false, basis, true)).toBe(true);
    });

    it('releases when the basis never lands (failed: not pending, nothing landed)', () => {
        expect(holdsForNestBasis(false, null, true)).toBe(false);
    });

    it('releases when nothing awaits it any more (taken by the zoom, or the chain cannot be derived)', () => {
        expect(holdsForNestBasis(false, basis, false)).toBe(false);
        expect(holdsForNestBasis(true, basis, false)).toBe(false);
    });
});
