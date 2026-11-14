import { describe, expect, it } from 'vitest';
import {
    ISOTONIC_MIN_EXAMPLES, RULE_CALIBRATION_PREDICTION_ID, calibrationPrediction, calibrateScores,
    type CalibrationExample,
} from './calibration.js';

/**
 * Scores that are informative about the label: outcome 1 when score ≥ 0.5. A calibrator
 * should map these to well-separated probabilities and beat the raw-score Brier.
 */
function examples(n: number, seed = 1): CalibrationExample[] {
    let s = seed;
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    return Array.from({ length: n }, () => {
        const score = Math.round(next() * 1000) / 1000;
        return { score, outcome: (score >= 0.5 ? 1 : 0) as 0 | 1 };
    });
}

describe('calibration (D4)', () => {
    it('below the data threshold it is insufficient-data', () => {
        expect(calibrateScores({ examples: [] }).status).toBe('insufficient-data');
        expect(calibrateScores({ examples: examples(3) }).status).toBe('insufficient-data');
    });

    it('kill switch off is model-disabled', () => {
        expect(calibrateScores({ examples: examples(100), disabled: true }).status).toBe('model-disabled');
    });

    it('uses Platt below and isotonic at/above the example threshold', () => {
        expect(calibrateScores({ examples: examples(ISOTONIC_MIN_EXAMPLES - 1) }).fit?.method).toBe('platt');
        expect(calibrateScores({ examples: examples(ISOTONIC_MIN_EXAMPLES) }).fit?.method).toBe('isotonic');
        expect(calibrateScores({ examples: examples(ISOTONIC_MIN_EXAMPLES + 1) }).fit?.method).toBe('isotonic');
    });

    it('calibration improves held-out fit over the raw score', () => {
        const data = examples(400);
        const result = calibrateScores({ examples: data });
        expect(result.status).toBe('ok');
        const fit = result.fit!;
        // Held-out raw-score Brier: the uncalibrated score is already 0/1, so its Brier is
        // the misclassification rate. A good calibrator separates the two score bands and
        // lands most held-out probabilities near 0 or 1, beating the raw-score baseline.
        const heldOutRaw = data.filter((_, i) => i % 2 === 1);
        const rawBrier = heldOutRaw.reduce((acc, e) => acc + (e.score - e.outcome) ** 2, 0) / heldOutRaw.length;
        expect(fit.brier).toBeLessThanOrEqual(rawBrier + 1e-9);
    });

    it('is deterministic: the same examples give the same fit, scores and digest', () => {
        const a = calibrateScores({ examples: examples(200) });
        const b = calibrateScores({ examples: examples(200) });
        expect(a.digest).toBe(b.digest);
        expect(a.fit?.brier).toBe(b.fit?.brier);
        expect(a.fit?.ece).toBe(b.fit?.ece);
        expect(a.fit?.predict(0.3)).toBe(b.fit?.predict(0.3));
    });

    it('prediction shape: value is the held-out ECE, quantized, with status mapped', () => {
        const ok = calibrateScores({ examples: examples(200) });
        const pred = calibrationPrediction(ok);
        expect(pred.id).toBe(RULE_CALIBRATION_PREDICTION_ID);
        expect(pred.status).toBe('ok');
        expect(pred.value).toBe(Math.round(ok.fit!.ece * 1000) / 1000);
        expect(pred.explanation.length).toBeGreaterThan(0);

        const disabled = calibrationPrediction(calibrateScores({ examples: examples(200), disabled: true }));
        expect(disabled.status).toBe('model-disabled');
        expect(disabled.value).toBe(0);
    });
});
