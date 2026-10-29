import { describe, expect, it } from 'vitest';
import { LOCAL_COST_TEXT, reviewCostOf, reviewCostSuffix } from './reviewCost.js';

describe('reviewCostOf (calls × price — the ONE validation of a price)', () => {
    it('multiplies the plan’s calls by the per-call price', () => {
        expect(reviewCostOf(37, { perCallUsd: 0.004, local: false })).toEqual({ kind: 'usd', usd: 37 * 0.004 });
        expect(reviewCostOf(37, { perCallUsd: 0, local: false })).toEqual({ kind: 'usd', usd: 0 });
    });

    it('a local engine is local, whatever perCallUsd says', () => {
        expect(reviewCostOf(37, { perCallUsd: 0, local: true })).toEqual({ kind: 'local' });
        expect(reviewCostOf(37, { perCallUsd: 5, local: true })).toEqual({ kind: 'local' });
    });

    it('is unknown for a missing, null, negative or non-finite price — never NaN or a made-up 0', () => {
        for (const price of [undefined, { perCallUsd: null, local: false }, { perCallUsd: -1, local: false }, { perCallUsd: Number.NaN, local: false }, { perCallUsd: Infinity, local: false }]) {
            expect(reviewCostOf(37, price)).toEqual({ kind: 'unknown' });
        }
    });
});

describe('reviewCostSuffix (the confirm chip’s ≈ cost on a host with no view)', () => {
    it('prices the plan’s calls at the server’s per-call estimate', async () => {
        expect(await reviewCostSuffix(37, async () => ({ perCallUsd: 0.004, local: false }))).toBe(' · ≈ $0.15');
    });

    it('states a free cloud model as $0.00, not as unknown', async () => {
        expect(await reviewCostSuffix(37, async () => ({ perCallUsd: 0, local: false }))).toBe(' · ≈ $0.00');
    });

    it('says a local engine costs nothing, in words', async () => {
        expect(await reviewCostSuffix(37, async () => ({ perCallUsd: 0, local: true }))).toBe(` · ${LOCAL_COST_TEXT}`);
    });

    it('adds nothing when the price is unknown, absent or failing', async () => {
        expect(await reviewCostSuffix(37, async () => ({ perCallUsd: null, local: false }))).toBe('');
        expect(await reviewCostSuffix(37, async () => undefined)).toBe('');
        expect(await reviewCostSuffix(37, undefined)).toBe('');
        expect(await reviewCostSuffix(37, async () => { throw new Error('offline'); })).toBe('');
    });
});
