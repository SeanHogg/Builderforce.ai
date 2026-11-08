import { describe, expect, it } from 'vitest';
import { canonicalHash } from './canonicalHash';

describe('canonicalHash', () => {
    it('ignores object key order', () => {
        expect(canonicalHash({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalHash({ b: { d: 3, c: 2 }, a: 1 }));
    });

    it('ignores Map and Set insertion order', () => {
        expect(canonicalHash(new Map([['a', 1], ['b', 2]]))).toBe(canonicalHash(new Map([['b', 2], ['a', 1]])));
        expect(canonicalHash(new Set([1, 2, 3]))).toBe(canonicalHash(new Set([3, 1, 2])));
    });

    it('keeps array order significant', () => {
        expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    });

    it('distinguishes -0 from 0, NaN from 0, and undefined from missing', () => {
        expect(canonicalHash(-0)).not.toBe(canonicalHash(0));
        expect(canonicalHash(NaN)).not.toBe(canonicalHash(0));
        expect(canonicalHash(NaN)).toBe(canonicalHash(NaN));
        expect(canonicalHash({ a: undefined })).not.toBe(canonicalHash({}));
    });

    it('distinguishes typed array types and values', () => {
        expect(canonicalHash(new Float64Array([1, 2]))).not.toBe(canonicalHash(new Float32Array([1, 2])));
        expect(canonicalHash(new Float32Array([1, 2]))).not.toBe(canonicalHash(new Float32Array([1, 3])));
        expect(canonicalHash(new Float32Array([1, 2]))).toBe(canonicalHash(new Float32Array([1, 2])));
    });

    it('is a short hex digest and survives a cycle', () => {
        const a: Record<string, unknown> = { x: 1 };
        a.self = a;
        expect(canonicalHash(a)).toMatch(/^[0-9a-f]{16}$/);
    });
});
