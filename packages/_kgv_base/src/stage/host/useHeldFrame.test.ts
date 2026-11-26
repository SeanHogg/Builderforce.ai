import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHeldFrame } from './useHeldFrame';

interface Frame { generation: number }
const f = (generation: number): Frame => ({ generation });

function setup(key: string, live: Frame | null) {
    return renderHook(({ k, l }) => useHeldFrame(k, l), { initialProps: { k: key, l: live } });
}

describe('useHeldFrame', () => {
    it('returns nothing on the first load until a frame is ready', () => {
        const { result, rerender } = setup('a|map|', null);
        expect(result.current).toBeNull();
        const first = f(1);
        rerender({ k: 'a|map|', l: first });
        expect(result.current).toBe(first);
    });

    it('keeps the last ready frame of the SAME key while the regenerated one computes, then swaps to the new one whole', () => {
        const one = f(1), two = f(2);
        const { result, rerender } = setup('a|map|', one);
        expect(result.current).toBe(one);
        rerender({ k: 'a|map|', l: null }); // regenerating
        expect(result.current).toBe(one);
        rerender({ k: 'a|map|', l: null });
        expect(result.current).toBe(one);
        rerender({ k: 'a|map|', l: two });
        expect(result.current).toBe(two);
    });

    it('never returns the old frame for another key (root, camera or drill level), even after it was held', () => {
        const one = f(1);
        const { result, rerender } = setup('a|map|', one);
        rerender({ k: 'a|map|package:x', l: null }); // a drill enter
        expect(result.current).toBeNull();
        rerender({ k: 'a|map|', l: null }); // back out: the old frame was dropped with the navigation
        expect(result.current).toBeNull();
        rerender({ k: 'b|map|', l: null });
        expect(result.current).toBeNull();
        const two = f(2);
        rerender({ k: 'b|graph|', l: two });
        expect(result.current).toBe(two);
        rerender({ k: 'b|graph|', l: null });
        expect(result.current).toBe(two);
    });
});
