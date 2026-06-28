import { describe, expect, it } from 'vitest';
import { computePctOfCap, pickTip } from './builderInsights';

describe('computePctOfCap', () => {
  it('returns null when there is no positive cap', () => {
    expect(computePctOfCap(500, null)).toBeNull();
    expect(computePctOfCap(500, 0)).toBeNull();
    expect(computePctOfCap(500, -1)).toBeNull();
  });

  it('computes a rounded percentage', () => {
    expect(computePctOfCap(5_000, 10_000)).toBe(50);
    expect(computePctOfCap(1_234, 10_000)).toBe(12.3);
    expect(computePctOfCap(10_000, 10_000)).toBe(100);
  });

  it('can exceed 100 when over cap', () => {
    expect(computePctOfCap(15_000, 10_000)).toBe(150);
  });

  it('clamps negative usage to 0', () => {
    expect(computePctOfCap(-100, 10_000)).toBe(0);
  });
});

describe('pickTip', () => {
  it('warns when above 80% of the daily cap (highest priority)', () => {
    expect(pickTip({ pctOfDailyCap: 85, topModel: { model: 'openai/gpt-4o', tokens: 1 } }))
      .toBe('Approaching daily token cap');
  });

  it('suggests a cheaper coder when the top model is expensive', () => {
    const tip = pickTip({ pctOfDailyCap: 10, topModel: { model: 'anthropic/claude-opus-4', tokens: 100 } });
    expect(tip).toContain('anthropic/claude-opus-4');
    expect(tip).toContain('cheaper');
  });

  it('returns null for a cheap model under cap', () => {
    expect(pickTip({ pctOfDailyCap: 10, topModel: { model: 'meta/llama-3', tokens: 100 } })).toBeNull();
  });

  it('returns null when there is no usage / no model', () => {
    expect(pickTip({ pctOfDailyCap: null, topModel: null })).toBeNull();
  });

  it('cap warning beats the expensive-model tip', () => {
    expect(pickTip({ pctOfDailyCap: 95, topModel: { model: 'openai/o3', tokens: 100 } }))
      .toBe('Approaching daily token cap');
  });
});
