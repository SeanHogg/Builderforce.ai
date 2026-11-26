/** THE rate formatter: n and the interval always; ≈ under 10; a reference share has no interval; 1-of-1 never reads 100%. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { FEW_SAMPLES, rateFormat } from './rateFormat';

describe('rateFormat', () => {
    it('marks a sample under 10 with ≈ and shows its interval and n', () => {
        const text = rateFormat(L, { k: 3, n: 4, low: 0.32, high: 0.97 });
        expect(text.startsWith('≈ ')).toBe(true);
        expect(text).toContain('(32–97)');
        expect(text).toContain('n = 4');
    });

    it('drops the ≈ from 10 observations up', () => {
        const text = rateFormat(L, { k: 6, n: FEW_SAMPLES, low: 0.33, high: 0.83 });
        expect(text.startsWith('≈')).toBe(false);
        expect(text).toMatch(/^\d+% \(33–83\) · n = 10$/);
    });

    it('never reads a 1-of-1 as 100%', () => {
        const text = rateFormat(L, { k: 1, n: 1, low: 0.15, high: 1 });
        expect(text).not.toMatch(/^≈ 100%/);
        expect(text.startsWith('≈ ')).toBe(true);
    });

    it('words a reference hop (no interval) as a share of references, not a rate', () => {
        const text = rateFormat(L, { k: 3, n: 4 });
        expect(text).toBe('3 of 4 references');
        expect(text).not.toContain('%');
        expect(text).not.toContain('≈');
    });
});
