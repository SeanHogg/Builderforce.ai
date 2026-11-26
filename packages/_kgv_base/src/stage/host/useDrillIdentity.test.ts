import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DrillFrame } from '../../surface/transit/drillView';
import { useDrillIdentity } from './useDrillIdentity';

const pkg = (ref: string): DrillFrame => ({ level: 'package', ref, name: ref });
const NONE: ReadonlyMap<string, string> = new Map();

describe('useDrillIdentity', () => {
    it('is stable across a re-anchor (the ref moved) and changes on out-then-enter to a sibling at the same depth', () => {
        const { result, rerender } = renderHook(({ s, m }) => useDrillIdentity(s, m), { initialProps: { s: [pkg('a')], m: NONE } });
        const first = result.current;
        rerender({ s: [pkg('b')], m: new Map([['a', 'b']]) }); // re-anchored onto a renumbered station
        expect(result.current).toBe(first);
        rerender({ s: [], m: new Map([['a', 'b']]) }); // out
        expect(result.current).not.toBe(first);
        const out = result.current;
        rerender({ s: [pkg('c')], m: new Map([['a', 'b']]) }); // in to a sibling
        expect(result.current).not.toBe(out);
    });

    it('a new stack array of the same frames keeps the identity; a deeper stack changes it', () => {
        const { result, rerender } = renderHook(({ s }) => useDrillIdentity(s, NONE), { initialProps: { s: [pkg('a')] } });
        const first = result.current;
        rerender({ s: [pkg('a')] });
        expect(result.current).toBe(first);
        rerender({ s: [pkg('a'), { level: 'class', ref: 'f', name: 'f' }] });
        expect(result.current).not.toBe(first);
    });
});
