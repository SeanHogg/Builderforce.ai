import { describe, it, expect } from 'vitest';
import { computeRfpCostModel, RFP_COST_DEFAULTS } from './rfpCost';

describe('computeRfpCostModel', () => {
  it('composes cost drivers and applies margin as a share of quoted revenue', () => {
    const m = computeRfpCostModel({
      effortWeeks: 10,
      blendedWeeklyRateUsd: 5000,
      agenticCostUsd: 2000,
      marginPct: 0.25,
      marketingPct: 0.1,
      contingencyPct: 0.1,
    });
    // build = 10 * 5000 = 50000; agentic = 2000
    expect(m.buildCostUsd).toBe(50000);
    expect(m.agenticCostUsd).toBe(2000);
    // marketing = 10% of (50000+2000) = 5200
    expect(m.marketingCostUsd).toBe(5200);
    // contingency = 10% of (50000+2000+5200) = 5720
    expect(m.contingencyUsd).toBe(5720);
    // subtotal = 62920
    expect(m.subtotalCostUsd).toBe(62920);
    // quoted = subtotal / (1 - 0.25); margin = quoted - subtotal
    expect(m.quotedPriceUsd).toBeCloseTo(62920 / 0.75, 1);
    expect(m.marginUsd).toBeCloseTo(m.quotedPriceUsd - m.subtotalCostUsd, 1);
    // margin is a quarter of the quoted price
    expect(m.marginUsd / m.quotedPriceUsd).toBeCloseTo(0.25, 4);
  });

  it('falls back to defaults for missing/invalid percentages and rate', () => {
    const m = computeRfpCostModel({ effortWeeks: 4, blendedWeeklyRateUsd: 0, agenticCostUsd: 0 });
    expect(m.buildCostUsd).toBe(4 * RFP_COST_DEFAULTS.blendedWeeklyRateUsd);
    expect(m.marginPct).toBe(RFP_COST_DEFAULTS.marginPct);
    // every line item is present
    expect(m.lineItems.map((l) => l.category)).toEqual(['build', 'agentic', 'marketing', 'contingency', 'margin']);
  });

  it('clamps a runaway margin (>=0.9) without dividing by zero', () => {
    const m = computeRfpCostModel({ effortWeeks: 1, blendedWeeklyRateUsd: 1000, agenticCostUsd: 0, marginPct: 5 });
    expect(Number.isFinite(m.quotedPriceUsd)).toBe(true);
    expect(m.quotedPriceUsd).toBeGreaterThan(0);
  });
});
