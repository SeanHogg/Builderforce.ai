import { describe, expect, it } from 'vitest';
import { computeHiringFunnel } from './hiringFunnel';
import type { Db } from '../../infrastructure/database/connection';

/**
 * A Drizzle stand-in that returns one fixed grouped result.
 *
 * The arithmetic is what is under test — conversion is per-stage rather than cumulative,
 * the bottleneck is the biggest LOSS rather than the worst percentage, and an empty
 * funnel reports nothing rather than zeroes. None of that needs Postgres, and a test that
 * needed one would not run in CI at all.
 */
function dbReturning(rows: unknown[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

const NOW = Date.now();
const day = (offset: number) => new Date(NOW - offset * 86_400_000);

describe('computeHiringFunnel', () => {
  it('reports per-stage conversion into the NEXT stage, not cumulatively', async () => {
    const funnel = await computeHiringFunnel(dbReturning([
      { stage: 'applied', source: 'inbound', entered: 100, exited: 100, firstEnteredAt: day(30), medianDays: 2 },
      { stage: 'screen', source: 'inbound', entered: 40, exited: 40, firstEnteredAt: day(25), medianDays: 5 },
      { stage: 'offer', source: 'inbound', entered: 10, exited: 8, firstEnteredAt: day(10), medianDays: 3 },
    ]), 1);

    expect(funnel.stages.map((stage) => stage.stage)).toEqual(['applied', 'screen', 'offer']);
    // 40 of 100 reached screen; 10 of 40 reached offer.
    expect(funnel.stages[0]?.conversion).toBe(40);
    expect(funnel.stages[1]?.conversion).toBe(25);
    // The terminal stage has nothing after it, so its conversion is what COMPLETED — not
    // 0, which would draw the offer stage as the worst performer in every funnel.
    expect(funnel.stages[2]?.conversion).toBe(80);
  });

  it('names the stage that loses the most PEOPLE, not the worst percentage', async () => {
    const funnel = await computeHiringFunnel(dbReturning([
      // Loses 140 of 200 — a 30% pass rate.
      { stage: 'applied', source: 'inbound', entered: 200, exited: 200, firstEnteredAt: day(40), medianDays: 1 },
      // Loses 55 of 60 — a far worse 8% pass rate, but only 55 people.
      { stage: 'screen', source: 'inbound', entered: 60, exited: 60, firstEnteredAt: day(30), medianDays: 4 },
      { stage: 'offer', source: 'inbound', entered: 5, exited: 5, firstEnteredAt: day(5), medianDays: 2 },
    ]), 1);
    expect(funnel.bottleneck).toBe('applied');
  });

  it('splits conversion by source, and names the unattributed share rather than hiding it', async () => {
    const funnel = await computeHiringFunnel(dbReturning([
      { stage: 'applied', source: 'referral', entered: 20, exited: 20, firstEnteredAt: day(30), medianDays: 1 },
      { stage: 'applied', source: null, entered: 80, exited: 80, firstEnteredAt: day(30), medianDays: 1 },
      { stage: 'hired', source: 'referral', entered: 8, exited: 8, firstEnteredAt: day(5), medianDays: 1 },
      { stage: 'hired', source: null, entered: 2, exited: 2, firstEnteredAt: day(5), medianDays: 1 },
    ]), 1);

    const referral = funnel.sourceBreakdown.find((entry) => entry.source === 'referral');
    const unattributed = funnel.sourceBreakdown.find((entry) => entry.source === 'unattributed');
    expect(referral?.rate).toBe(40);
    // A large unattributed share IS the finding, so it is named rather than dropped.
    expect(unattributed?.entered).toBe(80);
    expect(unattributed?.rate).toBe(3);
  });

  it('orders stages by when each was first entered, because stages are free-form', async () => {
    const funnel = await computeHiringFunnel(dbReturning([
      { stage: 'offer', source: null, entered: 5, exited: 5, firstEnteredAt: day(2), medianDays: 1 },
      { stage: 'coffee chat', source: null, entered: 50, exited: 50, firstEnteredAt: day(20), medianDays: 1 },
      { stage: 'deep dive', source: null, entered: 20, exited: 20, firstEnteredAt: day(10), medianDays: 1 },
    ]), 1);
    expect(funnel.stages.map((stage) => stage.stage)).toEqual(['coffee chat', 'deep dive', 'offer']);
  });

  it('reports an empty funnel as empty rather than as a card of zeroes', async () => {
    const funnel = await computeHiringFunnel(dbReturning([]), 1);
    expect(funnel.stages).toEqual([]);
    expect(funnel.totalEntered).toBe(0);
    expect(funnel.bottleneck).toBeNull();
    // Null, not 0: "nothing has completed yet" and "these all happened instantly" are
    // opposite facts, and only one is true of an empty funnel.
    expect(funnel.medianCycleDays).toBeNull();
  });

  it('states the window it measured, so the number is reproducible', async () => {
    const funnel = await computeHiringFunnel(dbReturning([]), 1, { days: 30 });
    expect(funnel.dateRange).toBe('last 30 days');
    expect(Date.parse(funnel.fetchedAt)).toBeGreaterThan(0);
  });

  it('clamps an absurd window instead of trusting it', async () => {
    const funnel = await computeHiringFunnel(dbReturning([]), 1, { days: 100_000 });
    expect(funnel.dateRange).toBe('last 365 days');
  });
});
