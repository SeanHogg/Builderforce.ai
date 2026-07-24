import { describe, it, expect } from 'vitest';
import { compareVariants, passesPromotionGate } from './variantEval';

// 40 tight samples around a mean — low variance so a real gap is significant.
function around(mean: number, n = 40): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(mean + (i % 2 === 0 ? 0.01 : -0.01));
  return out;
}

describe('compareVariants', () => {
  it('flags a clearly-better candidate as significant', () => {
    const cmp = compareVariants('evermind/base', around(0.6), 'evermind/ft', around(0.78));
    expect(cmp.delta).toBeCloseTo(0.18, 2);
    expect(cmp.verdict).toBe('better');
    expect(cmp.significant).toBe(true);
    expect(cmp.pValue).toBeLessThan(0.05);
  });

  it('flags a clearly-worse candidate', () => {
    const cmp = compareVariants('evermind/base', around(0.8), 'evermind/ft', around(0.6));
    expect(cmp.verdict).toBe('worse');
    expect(cmp.significant).toBe(true);
  });

  it('is inconclusive with too few samples even if the mean differs', () => {
    const cmp = compareVariants('base', around(0.6, 5), 'cand', around(0.8, 5), { minSamples: 30 });
    expect(cmp.significant).toBe(false);
    expect(cmp.verdict).toBe('inconclusive');
  });

  it('handles empty arms without throwing', () => {
    const cmp = compareVariants('base', [], 'cand', []);
    expect(cmp.verdict).toBe('inconclusive');
    expect(cmp.pValue).toBe(1);
  });
});

describe('passesPromotionGate', () => {
  it('promotes a significant, sufficient, margin-clearing win', () => {
    const cmp = compareVariants('base', around(0.6), 'cand', around(0.78));
    const d = passesPromotionGate(cmp, { minDelta: 0.02, minSamples: 30 });
    expect(d.promote).toBe(true);
  });

  it('holds when samples are insufficient', () => {
    const cmp = compareVariants('base', around(0.6, 10), 'cand', around(0.78, 10));
    const d = passesPromotionGate(cmp, { minSamples: 30 });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain('insufficient samples');
  });

  it('holds when the win is below the practical margin', () => {
    const cmp = compareVariants('base', around(0.70), 'cand', around(0.715));
    const d = passesPromotionGate(cmp, { minDelta: 0.05, minSamples: 30 });
    expect(d.promote).toBe(false);
    // either not significant enough or below margin — both are a hold
    expect(d.promote).toBe(false);
  });

  it('holds when the candidate is worse', () => {
    const cmp = compareVariants('base', around(0.8), 'cand', around(0.6));
    expect(passesPromotionGate(cmp).promote).toBe(false);
  });
});
