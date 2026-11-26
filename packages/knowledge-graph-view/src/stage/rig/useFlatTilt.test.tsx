// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { TWEEN_MS } from '../tween';
import type { RigController } from './rig';
import { useFlatTilt } from './useFlatTilt';

/** A rig that is only a ground view holding a depth. */
const fakeRig = (depth: number) => {
    const rig = { depth, orbiting: false, setFlat: vi.fn() };
    return rig as unknown as RigController & { depth: number };
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('useFlatTilt: the ONE depth driver (PRD 43 C4)', () => {
    const run = (flat: boolean, tilt: number | undefined, from: number) => {
        const rig = fakeRig(from);
        const seen: number[] = [];
        const setDepth = (d: number) => { rig.depth = d; seen.push(d); };
        const { rerender } = renderHook((p: { flat: boolean }) => useFlatTilt({ rig, flat: p.flat, ready: true, reducedMotion: false, tilt, setDepth, invalidate: () => {} }), { initialProps: { flat: !flat } });
        seen.length = 0;
        rig.depth = from;
        rerender({ flat });
        for (let t = 0; t <= TWEEN_MS + 100; t += 16) vi.advanceTimersByTime(16);
        return seen;
    };

    it('a Flat switch eases the depth down monotonically to 0, with no jump', () => {
        const seen = run(true, 1, 1);
        expect(seen.length).toBeGreaterThan(3);
        expect(seen.at(-1)).toBe(0);
        for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
        expect(seen[0]!).toBeGreaterThan(0.8); // the first step is near where it was
    });

    it('a 3D switch eases up monotonically to the tilt the host asked for', () => {
        const seen = run(false, 1, 0);
        expect(seen.length).toBeGreaterThan(3);
        expect(seen.at(-1)).toBe(1);
        for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
        expect(seen[0]!).toBeLessThan(0.2);
    });
});
