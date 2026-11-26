// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FLAT_VIEW_KEY, useFlatView } from './useFlatView';

// jsdom may run without a usable localStorage (the experimental flag): a fake Storage stands in, like the view's own tests.
const mem = new Map<string, string>();
const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };

beforeEach(() => { mem.clear(); vi.stubGlobal('localStorage', fake); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('useFlatView (PRD 43 C4)', () => {
    it('starts in 3D and switches', () => {
        const { result } = renderHook(() => useFlatView());
        expect(result.current.flat).toBe(false);
        act(() => result.current.setFlat(true));
        expect(result.current.flat).toBe(true);
        act(() => result.current.setFlat(false));
        expect(result.current.flat).toBe(false);
    });

    it('remembers the choice per viewer', () => {
        const first = renderHook(() => useFlatView());
        act(() => first.result.current.setFlat(true));
        expect(mem.get(FLAT_VIEW_KEY)).toBe('true');
        first.unmount();
        const second = renderHook(() => useFlatView());
        expect(second.result.current.flat).toBe(true);
    });

    it('reads the stored choice on the FIRST render (no 3D flash, no second placement)', () => {
        mem.set(FLAT_VIEW_KEY, 'true');
        const seen: boolean[] = [];
        renderHook(() => { const v = useFlatView(); seen.push(v.flat); return v; });
        expect(seen[0]).toBe(true);
        expect(seen.every((f) => f)).toBe(true);
    });

    it('works with storage blocked or missing', () => {
        const blocked = { ...fake, getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        vi.stubGlobal('localStorage', blocked);
        const { result } = renderHook(() => useFlatView());
        expect(result.current.flat).toBe(false);
        act(() => result.current.setFlat(true));
        expect(result.current.flat).toBe(true);
        vi.stubGlobal('localStorage', undefined);
        const missing = renderHook(() => useFlatView());
        expect(missing.result.current.flat).toBe(false);
    });
});
