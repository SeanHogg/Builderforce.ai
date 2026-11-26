import { describe, expect, it } from 'vitest';
import { spanOf, STAGGER_MS, STAGGER_STEPS, TWEEN_MS, Tween } from './tween';

describe('the placement tween (760 ms, cubic in-out, 45 ms stagger by index)', () => {
    it('one mark runs 760 ms; the whole tween adds the stagger, and 0 (reduced motion) stays 0', () => {
        expect(TWEEN_MS).toBe(760);
        expect(STAGGER_MS).toBe(45);
        expect(spanOf(TWEEN_MS)).toBe(TWEEN_MS + STAGGER_STEPS * STAGGER_MS);
        expect(spanOf(0)).toBe(0);
    });

    it('is eased (cubic in-out) while its linear progress runs straight; both land on 1', () => {
        const t = new Tween();
        t.begin(0, 1000);
        expect(t.at(250)).toBeCloseTo(4 * 0.25 ** 3);
        expect(t.linear).toBeCloseTo(0.25);
        expect(t.at(1000)).toBe(1);
        expect(t.active).toBe(false);
        expect(t.linear).toBe(1);
    });
});
