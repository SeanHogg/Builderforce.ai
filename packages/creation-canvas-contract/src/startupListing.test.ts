/**
 * The runway arithmetic, asserted once for every surface that prints it.
 *
 * The one consequential mistake available here is dividing by gross spend
 * instead of net burn — it understates a company with revenue by the ratio of
 * revenue to spend, and a founder acts on the result.
 */
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_STAGES,
  FUNDING_STAGES,
  computeRunway,
  isFundingStage,
  monthKey,
  projectCashflow,
  startupProfilePath,
} from './startupListing';

describe('computeRunway', () => {
  it('is cash over NET burn', () => {
    const verdict = computeRunway({ cashOnHand: 100_000, monthlyBudget: 100_000, monthlyRevenue: 80_000 });
    expect(verdict.netBurn).toBe(20_000);
    expect(verdict.runwayMonths).toBe(5);
  });

  it('has no runway in months, and is profitable, when revenue covers spend', () => {
    const verdict = computeRunway({ cashOnHand: 10_000, monthlyBudget: 50_000, monthlyRevenue: 50_000 });
    expect(verdict.runwayMonths).toBeNull();
    expect(verdict.health).toBe('profitable');
    expect(verdict.zeroCashDate).toBeNull();
  });

  it('bands health at six and twelve months', () => {
    expect(computeRunway({ cashOnHand: 50_000, monthlyBudget: 10_000 }).health).toBe('critical');
    expect(computeRunway({ cashOnHand: 100_000, monthlyBudget: 10_000 }).health).toBe('watch');
    expect(computeRunway({ cashOnHand: 130_000, monthlyBudget: 10_000 }).health).toBe('healthy');
  });

  it('rounds to a tenth of a month and dates the cash-out from now', () => {
    const now = new Date('2026-09-15T00:00:00Z');
    const verdict = computeRunway({ cashOnHand: 100_000, monthlyBudget: 30_000 }, now);
    expect(verdict.runwayMonths).toBe(3.3);
    expect(verdict.zeroCashDate?.slice(0, 7)).toBe('2026-12');
  });

  it('treats missing and negative cash as zero rather than as a number', () => {
    expect(computeRunway({ cashOnHand: -5, monthlyBudget: 10 }).runwayMonths).toBe(0);
    expect(computeRunway({ monthlyBudget: 10 }).runwayMonths).toBe(0);
  });
});

describe('projectCashflow', () => {
  it('walks the balance forward one month at a time from the first of this month', () => {
    const series = projectCashflow({ cashOnHand: 100_000, monthlyBudget: 30_000, monthlyRevenue: 10_000 }, 3, new Date('2026-09-15T12:00:00Z'));
    expect(series.map((p) => p.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(series.map((p) => p.endingBalance)).toEqual([80_000, 60_000, 40_000]);
    expect(series[0]).toMatchObject({ inflows: 10_000, outflows: 30_000, net: -20_000 });
  });

  it('returns nothing for zero months', () => {
    expect(projectCashflow({ cashOnHand: 1 }, 0)).toEqual([]);
  });
});

describe('the vocabulary', () => {
  it('walks the funding stages in the order a company does', () => {
    expect(FUNDING_STAGES[0]).toBe('bootstrapped');
    expect(FUNDING_STAGES.at(-1)).toBe('ipo_ready');
    expect(isFundingStage('seed')).toBe(true);
    expect(isFundingStage('SEED')).toBe(false);
  });

  it('keeps business stage separate from money raised', () => {
    expect(BUSINESS_STAGES).toContain('early_revenue');
    expect(FUNDING_STAGES).not.toContain('early_revenue');
  });

  it('keys months in UTC and spells the profile path once', () => {
    expect(monthKey(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01');
    expect(startupProfilePath('acme robotics')).toBe('/marketplace/company/acme%20robotics');
  });
});
