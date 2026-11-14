import { describe, expect, it } from 'vitest';
import {
    METRIC_SPC_PREDICTION_ID, SPC_MIN_HISTORY, detectTrendShift, spcPrediction,
} from './spc.js';

/** `n` in-control runs around `mu` (small deterministic jitter), then a level shift. */
function driftingSeries(n: number, mu = 0, shift = 2): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(mu + ((i % 3) - 1) * 0.1);
    for (let i = 0; i < 12; i++) out.push(mu + shift + ((i % 3) - 1) * 0.1);
    return out;
}

/** Exactly `n` in-control runs (small deterministic jitter) — no trailing shift. */
function inControlSeries(n: number, mu = 0): number[] {
    return Array.from({ length: n }, (_, i) => mu + ((i % 3) - 1) * 0.1);
}

describe('trend SPC (D7)', () => {
    it('below the minimum history it is insufficient-data and learning baseline', () => {
        const result = detectTrendShift({ values: inControlSeries(SPC_MIN_HISTORY - 1), sigma: 1 });
        expect(result.status).toBe('insufficient-data');
        expect(result.baseline).toBe(true);
        expect(result.signal).toBeUndefined();
    });

    it('kill switch off is model-disabled', () => {
        const result = detectTrendShift({ values: driftingSeries(40), sigma: 1, disabled: true });
        expect(result.status).toBe('model-disabled');
        expect(result.baseline).toBe(false);
    });

    it('detects a sustained level shift (CUSUM alarm or change-point posterior)', () => {
        const result = detectTrendShift({ values: driftingSeries(SPC_MIN_HISTORY + 10), sigma: 1 });
        expect(result.status).toBe('ok');
        expect(result.baseline).toBe(false);
        expect(result.cusum).toBeDefined();
        expect(result.changePoint).toBeDefined();
        // A clear 2σ sustained shift must register at least one signal.
        expect(result.signal).toBeDefined();
        if (result.signal?.kind === 'cusum') {
            expect(result.signal.alarmIndex).toBeGreaterThanOrEqual(SPC_MIN_HISTORY);
        } else if (result.signal?.kind === 'change-point') {
            expect(result.signal.index).toBeGreaterThanOrEqual(SPC_MIN_HISTORY - 1);
            expect(result.signal.probability).toBeGreaterThan(0);
        }
    });

    it('an in-control series produces no CUSUM alarm', () => {
        const inControl: number[] = [];
        for (let i = 0; i < SPC_MIN_HISTORY + 20; i++) inControl.push(((i % 5) - 2) * 0.05);
        const result = detectTrendShift({ values: inControl, sigma: 1 });
        expect(result.status).toBe('ok');
        expect(result.cusum!.alarmIndex).toBe(-1);
    });

    it('is deterministic: same inputs give the same signal and digest', () => {
        const values = driftingSeries(SPC_MIN_HISTORY + 10);
        const a = detectTrendShift({ values, sigma: 1 });
        const b = detectTrendShift({ values, sigma: 1 });
        expect(a.signal).toEqual(b.signal);
        expect(spcPrediction({ values, sigma: 1 }, a).inputDigest)
            .toBe(spcPrediction({ values, sigma: 1 }, b).inputDigest);
    });

    it('prediction shape: value is the signal probability, quantized, with status mapped', () => {
        const values = driftingSeries(SPC_MIN_HISTORY + 10);
        const result = detectTrendShift({ values, sigma: 1 });
        const pred = spcPrediction({ values, sigma: 1 }, result);
        expect(pred.id).toBe(METRIC_SPC_PREDICTION_ID);
        expect(pred.status).toBe('ok');
        expect(pred.value).toBeGreaterThanOrEqual(0);
        expect(pred.value).toBeLessThanOrEqual(1);

        const thin = detectTrendShift({ values: values.slice(0, 5), sigma: 1 });
        expect(spcPrediction({ values: values.slice(0, 5), sigma: 1 }, thin).status).toBe('insufficient-data');
    });
});
