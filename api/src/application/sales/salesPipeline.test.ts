import { describe, expect, it } from 'vitest';
import {
  dealProbabilityPercent, quotaFor, STAGE_PROBABILITY_PERCENT, summarizePipeline,
  windowEnd, windowStart, type PipelineDeal,
} from './salesReports';

/**
 * The forecast half of the sales report.
 *
 * Every assertion here is about a number that would otherwise be plausible and wrong: a
 * quota meter that reads green because it silently added a forecast to booked revenue, a
 * pipeline total that counted last quarter's won deals, a deal expected to close in
 * November counted toward August's number. Those are the failures that make a forecast
 * worse than none, so they are the ones that get a test.
 */
describe('weighted pipeline', () => {
  const deals: PipelineDeal[] = [
    { stage: 'qualified', valueCents: 100_000, probabilityPercent: null, expectedCloseAt: new Date('2026-08-20T00:00:00Z') },
    { stage: 'proposal', valueCents: 500_000, probabilityPercent: 80, expectedCloseAt: new Date('2026-08-25T00:00:00Z') },
    { stage: 'proposal', valueCents: 0, probabilityPercent: null, expectedCloseAt: null },
    { stage: 'new', valueCents: 200_000, probabilityPercent: null, expectedCloseAt: new Date('2026-11-01T00:00:00Z') },
    { stage: 'won', valueCents: 900_000, probabilityPercent: null, expectedCloseAt: new Date('2026-08-01T00:00:00Z') },
    { stage: 'lost', valueCents: 700_000, probabilityPercent: null, expectedCloseAt: new Date('2026-08-02T00:00:00Z') },
  ];
  const now = new Date('2026-08-19T00:00:00Z');
  const window = { from: windowStart('month', now), to: windowEnd('month', now) };

  it('drops closed deals from the open pipeline', () => {
    const pipeline = summarizePipeline(deals, window);
    expect(pipeline.openCount).toBe(4);
    expect(pipeline.openValueCents).toBe(800_000);
    // 100,000×25% + 500,000×80% + 0 + 200,000×5% = 435,000.
    expect(pipeline.weightedCents).toBe(435_000);
  });

  it('counts only what lands inside the window', () => {
    const pipeline = summarizePipeline(deals, window);
    // November's £2,000 deal is real pipeline and is NOT August's forecast — the omission
    // that makes every un-windowed forecast look achievable.
    expect(pipeline.weightedInWindowCents).toBe(25_000 + 400_000);
  });

  it('says "nothing is dated" rather than "nothing lands"', () => {
    const undated = summarizePipeline(
      [{ stage: 'proposal', valueCents: 500_000, probabilityPercent: null, expectedCloseAt: null }],
      window,
    );
    // null, not 0: a forecast of zero and an unforecastable pipeline are different
    // answers, and rendering them the same is how a quarter goes quiet.
    expect(undated.weightedInWindowCents).toBeNull();
  });

  it('surfaces the deals nobody has priced', () => {
    expect(summarizePipeline(deals, window).unpricedCount).toBe(1);
  });

  it('orders stages by the policy, and keeps an unknown stage visible', () => {
    const pipeline = summarizePipeline([
      { stage: 'proposal', valueCents: 1, probabilityPercent: null, expectedCloseAt: null },
      { stage: 'invented', valueCents: 1, probabilityPercent: null, expectedCloseAt: null },
      { stage: 'new', valueCents: 1, probabilityPercent: null, expectedCloseAt: null },
    ], null);
    expect(pipeline.stages.map((row) => row.stage)).toEqual(['new', 'proposal', 'invented']);
    // A stage the policy does not know weights to zero rather than vanishing.
    expect(pipeline.stages[2]).toMatchObject({ stage: 'invented', weightedCents: 0, count: 1 });
  });

  it('prefers a human judgement, and reads 0 as "not overridden"', () => {
    expect(dealProbabilityPercent('proposal', 80)).toBe(80);
    expect(dealProbabilityPercent('proposal', 0)).toBe(STAGE_PROBABILITY_PERCENT.proposal);
    expect(dealProbabilityPercent('proposal', null)).toBe(STAGE_PROBABILITY_PERCENT.proposal);
    expect(dealProbabilityPercent('invented', null)).toBe(0);
  });
});

describe('quota with a forecast', () => {
  it('keeps booked and forecast revenue apart', () => {
    const quota = quotaFor(1_000_000, 400_000, 'month', 300_000);
    expect(quota.attainmentPercent).toBe(40);
    expect(quota.projectedPercent).toBe(70);
    // The two are separate FIELDS, not one blended figure — a single "projected
    // attainment" is how a meter reads green in a quarter that misses.
    expect(quota.attainedCents).toBe(400_000);
    expect(quota.forecastCents).toBe(300_000);
  });

  it('reports no percentage at all when no goal is set', () => {
    const quota = quotaFor(0, 400_000, 'month', 300_000);
    expect(quota.attainmentPercent).toBeNull();
    expect(quota.projectedPercent).toBeNull();
  });
});

describe('window ends', () => {
  const now = new Date('2026-08-19T12:34:56Z');

  it('closes each window exactly one period after it opens', () => {
    expect(windowEnd('week', now).getTime() - windowStart('week', now).getTime()).toBe(7 * 86_400_000);
    expect(windowEnd('month', now).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(windowStart('quarter', now).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(windowEnd('quarter', now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('leaves `all` open at both ends', () => {
    expect(windowStart('all', now).getTime()).toBe(0);
    expect(windowEnd('all', now).getTime()).toBeGreaterThan(now.getTime());
  });

  it('does not mutate the start it derives the end from', () => {
    // `windowEnd` builds on `windowStart`'s Date; returning a mutated instance would make
    // a caller that computed both get the same object twice.
    const start = windowStart('month', now).getTime();
    windowEnd('month', now);
    expect(windowStart('month', now).getTime()).toBe(start);
  });
});
