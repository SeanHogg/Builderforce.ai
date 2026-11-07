import { describe, expect, it } from 'vitest';
import { placeTerminus, terminusBox } from './terminusPlace';

const markAt = (x: number, y: number, r = 12) => ({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
const from = { x: 100, y: 100 };

describe('placeTerminus', () => {
    it('stands beside its station when that is free', () => {
        const at = placeTerminus(from, 10, [markAt(100, 100)], []);
        expect(at).toEqual({ x: 152, y: 100 });
    });

    it('does not stand on the next station of the row: it goes under it', () => {
        const at = placeTerminus(from, 10, [markAt(100, 100), markAt(152, 100)], []);
        expect(at).toEqual({ x: 100, y: 156 });
    });

    it('keeps clear of an end already placed', () => {
        const taken = [terminusBox({ x: 152, y: 100 })];
        expect(placeTerminus(from, 10, [markAt(100, 100)], taken)).toEqual({ x: 100, y: 156 });
    });

    it('takes the first place when every one is taken, rather than none', () => {
        const everywhere = [{ x: -1000, y: -1000, w: 3000, h: 3000 }];
        expect(placeTerminus(from, 10, [], everywhere)).toEqual({ x: 152, y: 100 });
    });
});
