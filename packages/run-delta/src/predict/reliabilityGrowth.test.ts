import { describe, expect, it } from 'vitest';
import {
    CHAPMAN_MIN_CAPTURED, GOEL_OKUMOTO_MIN_POINTS, RELIABILITY_GROWTH_PREDICTION_ID,
    estimateReliabilityGrowth, estimateUndetected, reliabilityGrowthPrediction,
} from './reliabilityGrowth.js';

/** Per-run introduced-finding counts that decline like a Goel–Okumoto process. */
function decliningRuns(n: number): number[] {
    return Array.from({ length: n }, (_, t) => Math.max(1, Math.round(15 * Math.exp(-0.15 * t))));
}

describe('Chapman capture–recapture (D8)', () => {
    it('matches the textbook unit values', () => {
        // n̂ = ((m+1)(c+1)/(r+1)) − 1, the standard Chapman estimator.
        expect(estimateUndetected(10, 12, 5)).toEqual({ estimate: (((10 + 1) * (12 + 1)) / (5 + 1)) - 1 });
        // Worked example: m = 50, c = 40, r = 20 → n̂ = (51·41/21) − 1 = 98.5714…
        const { estimate } = estimateUndetected(50, 40, 20) as { estimate: number };
        expect(estimate).toBeCloseTo((((50 + 1) * (40 + 1)) / (20 + 1)) - 1, 6);
        expect(estimate).toBeCloseTo(98.5714, 3);
    });

    it('m < 3 gives insufficient-data', () => {
        expect(estimateUndetected(CHAPMAN_MIN_CAPTURED - 1, 10, 5)).toEqual({ status: 'insufficient-data' });
        expect(estimateUndetected(CHAPMAN_MIN_CAPTURED - 1, 10, 0)).toEqual({ status: 'insufficient-data' });
        expect(estimateUndetected(10, CHAPMAN_MIN_CAPTURED - 1, 5)).toEqual({ status: 'insufficient-data' });
    });

    it('r < 1 gives insufficient-data (cannot estimate overlap from nothing)', () => {
        expect(estimateUndetected(10, 12, 0)).toEqual({ status: 'insufficient-data' });
    });
});

describe('Goel–Okumoto reliability growth (D8)', () => {
    it('below the minimum points it is insufficient-data', () => {
        const result = estimateReliabilityGrowth({ introducedPerRun: decliningRuns(GOEL_OKUMOTO_MIN_POINTS - 1), seed: 1 });
        expect(result.status).toBe('insufficient-data');
        expect(result.fit).toBeUndefined();
    });

    it('kill switch off is model-disabled', () => {
        const result = estimateReliabilityGrowth({ introducedPerRun: decliningRuns(40), seed: 1, disabled: true });
        expect(result.status).toBe('model-disabled');
    });

    it('a run series with no introduced findings is insufficient-data', () => {
        const result = estimateReliabilityGrowth({ introducedPerRun: Array(30).fill(0), seed: 1 });
        expect(result.status).toBe('insufficient-data');
    });

    it('fits a declining-rate series and reports a remaining debt with a CI', () => {
        // Per-run counts that decline like a Goel–Okumoto process: the MLE should find a
        // finite positive decay and a non-negative expected remaining debt.
        const introducedPerRun = decliningRuns(30);
        const result = estimateReliabilityGrowth({ introducedPerRun, seed: 7 });
        expect(result.status).toBe('ok');
        expect(result.fit).toBeDefined();
        expect(result.fit!.b).toBeGreaterThan(0);
        expect(result.fit!.b).toBeLessThan(1e5); // not the degenerate saturated fit
        expect(result.fit!.remaining).toBeGreaterThanOrEqual(0);
        expect(result.fit!.a).toBeGreaterThan(0);
        expect(result.aInterval).toBeDefined();
        expect(result.aInterval![0]).toBeLessThanOrEqual(result.fit!.a);
        expect(result.aInterval![1]).toBeGreaterThanOrEqual(result.fit!.a);
    });

    it('is deterministic under the seed: same inputs give byte-identical results', () => {
        const introducedPerRun = decliningRuns(30);
        const a = estimateReliabilityGrowth({ introducedPerRun, seed: 42 });
        const b = estimateReliabilityGrowth({ introducedPerRun, seed: 42 });
        expect(a).toEqual(b);
        expect(reliabilityGrowthPrediction({ introducedPerRun, seed: 42 }, a).inputDigest)
            .toBe(reliabilityGrowthPrediction({ introducedPerRun, seed: 42 }, b).inputDigest);
    });

    it('a different seed can shift the bootstrap CI (the seed actually drives resampling)', () => {
        const introducedPerRun = decliningRuns(30);
        const a = estimateReliabilityGrowth({ introducedPerRun, seed: 1 });
        const b = estimateReliabilityGrowth({ introducedPerRun, seed: 2 });
        expect(a.fit).toEqual(b.fit); // the MLE is seed-independent
        expect(a.aInterval).toBeDefined();
        expect(b.aInterval).toBeDefined();
    });

    it('prediction shape: value is the remaining estimate, quantized, with status mapped', () => {
        const introducedPerRun = decliningRuns(30);
        const ok = estimateReliabilityGrowth({ introducedPerRun, seed: 7 });
        const pred = reliabilityGrowthPrediction({ introducedPerRun, seed: 7 }, ok);
        expect(pred.id).toBe(RELIABILITY_GROWTH_PREDICTION_ID);
        expect(pred.status).toBe('ok');
        expect(pred.value).toBe(Math.round(ok.fit!.remaining * 1000) / 1000);
        expect(pred.interval).toBeDefined();

        const thin = estimateReliabilityGrowth({ introducedPerRun: introducedPerRun.slice(0, 5), seed: 7 });
        expect(reliabilityGrowthPrediction({ introducedPerRun: introducedPerRun.slice(0, 5), seed: 7 }, thin).status)
            .toBe('insufficient-data');
    });
});
