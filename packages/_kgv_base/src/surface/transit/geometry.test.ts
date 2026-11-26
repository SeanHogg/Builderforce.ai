import { describe, expect, it } from 'vitest';
import { compact, CORNER, midpoint, roundedPath } from './geometry';

describe('roundedPath', () => {
    it('rounds each corner on the 14px radius by default', () => {
        expect(CORNER).toBe(14);
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }])).toBe('M 0 0 L 0 86 Q 0 100 14 100 L 100 100');
    });
    it('shrinks the radius on a short run and handles one and no points', () => {
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 40, y: 10 }])).toBe('M 0 0 L 0 5 Q 0 10 5 10 L 40 10');
        expect(roundedPath([{ x: 3, y: 4 }])).toBe('M 3 4');
        expect(roundedPath([])).toBe('');
    });
});

describe('compact and midpoint', () => {
    it('drops consecutive duplicates only', () => {
        expect(compact([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
    });
    it('finds the middle by length', () => {
        expect(midpoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 30, y: 10 }])).toEqual({ x: 10, y: 10 });
        expect(midpoint([])).toEqual({ x: 0, y: 0 });
    });
});
