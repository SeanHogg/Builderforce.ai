/**
 * The founder's free calculators (PRD 19 B1) — the arithmetic a person acts on.
 */
import { describe, expect, it } from 'vitest';
import { computeRunway } from '@builderforce/creation-canvas-contract';
import { STARTUP_FINANCE_TOOLS } from './startupFinanceTools';
import { getTool } from './toolDefinitions';

const tool = (id: string) => {
  const found = STARTUP_FINANCE_TOOLS.find((t) => t.id === id);
  if (!found) throw new Error(`no tool ${id}`);
  return found;
};

describe('the startup finance tools are registered', () => {
  it('every one is reachable through the registry under the finance category', () => {
    for (const t of STARTUP_FINANCE_TOOLS) {
      expect(getTool(t.id)?.category).toBe('finance');
    }
  });

  it('every one computes from its own defaults without throwing', () => {
    for (const t of STARTUP_FINANCE_TOOLS) {
      const defaults = Object.fromEntries(t.inputs.map((i) => [i.id, i.default]));
      const result = t.compute(defaults);
      expect(result.headline.length).toBeGreaterThan(0);
      expect(result.metrics.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
  });
});

describe('runway-calculator', () => {
  it('prints the SAME runway the contract formula computes', () => {
    const result = tool('runway-calculator').compute({ cashOnHand: 400_000, monthlySpend: 50_000, monthlyRevenue: 10_000 });
    const verdict = computeRunway({ cashOnHand: 400_000, monthlyBudget: 50_000, monthlyRevenue: 10_000 });
    expect(result.headline).toContain(String(verdict.runwayMonths));
    expect(result.scoreLabel).toBe('Watch');
  });

  it('says it is not burning when revenue covers spend', () => {
    const result = tool('runway-calculator').compute({ cashOnHand: 10_000, monthlySpend: 20_000, monthlyRevenue: 25_000 });
    expect(result.headline).toMatch(/Not burning/);
    expect(result.recommendations[0]?.title).toBe('Reinvest deliberately');
  });
});

describe('burn-rate-calculator', () => {
  it('separates gross from net and names payroll as the lever when it dominates', () => {
    const result = tool('burn-rate-calculator').compute({ payroll: 70_000, toolsAndInfra: 10_000, other: 5_000, monthlyRevenue: 20_000 });
    expect(result.headline).toContain('65,000');
    expect(result.metrics.find((m) => m.label === 'Gross burn')?.value).toContain('85,000');
    expect(result.recommendations.some((r) => r.title === 'Headcount is the lever')).toBe(true);
  });
});

describe('break-even-calculator', () => {
  it('computes units from fixed cost over contribution margin and walks growth to them', () => {
    // 50k fixed / (200 − 40) margin = 312.5 → 313 units; 120 units growing 8% a month → 13 months.
    const result = tool('break-even-calculator').compute({ fixedCosts: 50_000, pricePerUnit: 200, variableCostPerUnit: 40, currentUnits: 120, monthlyGrowthPct: 8 });
    expect(result.headline).toContain('313');
    expect(result.metrics.find((m) => m.label.startsWith('Months to break-even'))?.value).toBe('13');
  });

  it('refuses to invent a break-even when each unit loses money', () => {
    const result = tool('break-even-calculator').compute({ fixedCosts: 10_000, pricePerUnit: 10, variableCostPerUnit: 12, currentUnits: 100, monthlyGrowthPct: 5 });
    expect(result.headline).toMatch(/No break-even/);
  });

  it('reports "now" when volume already covers fixed costs', () => {
    const result = tool('break-even-calculator').compute({ fixedCosts: 1_000, pricePerUnit: 100, variableCostPerUnit: 20, currentUnits: 500, monthlyGrowthPct: 0 });
    expect(result.headline).toMatch(/Already past/);
  });
});

describe('churn-calculator', () => {
  it('annualises churn and derives lifetime and LTV from it', () => {
    const result = tool('churn-calculator').compute({ customersStart: 400, customersLost: 12, arpu: 90 });
    expect(result.headline).toBe('3% monthly churn');
    expect(result.metrics.find((m) => m.label === 'Annualised churn')?.value).toBe('31%');
    expect(result.metrics.find((m) => m.label === 'Customer lifetime value')?.value).toBe('$3,000');
  });
});

describe('pricing-simulator', () => {
  it('projects MRR, LTV and LTV : CAC before and after a price change', () => {
    const result = tool('pricing-simulator').compute({ currentPrice: 80, customers: 300, monthlyChurnPct: 3, cac: 900, proposedPrice: 110, churnChangePts: 0.5 });
    expect(result.headline).toBe('MRR $24,000 → $33,000');
    expect(result.metrics.find((m) => m.label === 'LTV : CAC today')?.value).toBe('3 : 1');
    expect(result.recommendations.some((r) => r.title === 'The price only works if churn holds')).toBe(true);
  });
});
