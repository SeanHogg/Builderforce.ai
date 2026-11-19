import { describe, expect, it } from 'vitest';
import type { CapTableHolder, ShareClassRow } from './equity';
import { computeWaterfall, exitRange, goalSeekExit, sensitivity } from './exitWaterfall';

const cls = (over: Partial<ShareClassRow> & { classRef: string }): ShareClassRow => ({
  id: 1,
  name: over.classRef,
  kind: 'common',
  authorized: 0,
  pricePerShare: null,
  seniority: 0,
  liquidationMultiple: null,
  participating: false,
  ...over,
});

const holder = (over: Partial<CapTableHolder> & { holderRef: string; shareClassRef: string; shares: number }): CapTableHolder => ({
  holderName: over.holderRef,
  shareClassName: over.shareClassRef,
  instrument: 'shares',
  vested: over.shares,
  unvested: 0,
  percentFullyDiluted: 0,
  ...over,
});

const ASOF = new Date('2026-01-01T00:00:00Z');

const common = cls({ classRef: 'common' });
const seriesA = (over: Partial<ShareClassRow> = {}) =>
  cls({ classRef: 'a', kind: 'preferred', pricePerShare: 1, liquidationMultiple: 1, seniority: 1, ...over });

const payout = (r: ReturnType<typeof computeWaterfall>, ref: string) => r.byHolder.find((h) => h.partyRef === ref)?.payout ?? 0;

describe('computeWaterfall', () => {
  /*
   * Hand-built spreadsheet case.
   *   Founder: 8,000,000 common.  Investor: 2,000,000 Series A at $1.00 = $2,000,000 invested,
   *   1x non-participating.  Exit $10,000,000, no debt.
   *   As-converted: investor owns 2/10 = 20% → $2,000,000.  Preference = 1 × 2,000,000 = $2,000,000.
   *   Equal → breakpoint at exactly $10M (convert when exit > $10M).
   *   Exit $5M: investor takes preference $2M; founder gets $3M.  (founder multiple n/a: no invested)
   *   Exit $20M: converts → investor 20% × 20M = $4M, founder 80% × 20M = $16M.  Investor multiple = 4M/2M = 2.0.
   */
  it('matches the hand-built spreadsheet case', () => {
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 8_000_000 }),
      holder({ holderRef: 'inv', shareClassRef: 'a', shares: 2_000_000 }),
    ];
    const classes = [common, seriesA()];
    const low = computeWaterfall({ holders, classes, exitValue: 5_000_000, vesting: 'normal', asOf: ASOF });
    expect(payout(low, 'inv')).toBeCloseTo(2_000_000, 0);
    expect(payout(low, 'founder')).toBeCloseTo(3_000_000, 0);
    const high = computeWaterfall({ holders, classes, exitValue: 20_000_000, vesting: 'normal', asOf: ASOF });
    expect(payout(high, 'inv')).toBeCloseTo(4_000_000, 0);
    expect(payout(high, 'founder')).toBeCloseTo(16_000_000, 0);
    expect(high.byHolder.find((h) => h.partyRef === 'inv')?.multiple).toBeCloseTo(2, 5);
    expect(high.byHolder.find((h) => h.partyRef === 'founder')?.multiple).toBeNull();
  });

  it('non-participating converts above its breakpoint', () => {
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 8_000_000 }),
      holder({ holderRef: 'inv', shareClassRef: 'a', shares: 2_000_000 }),
    ];
    const classes = [common, seriesA()];
    const below = computeWaterfall({ holders, classes, exitValue: 8_000_000, vesting: 'normal', asOf: ASOF });
    expect(below.byClass.find((c) => c.classRef === 'a')?.converted).toBe(false);
    const above = computeWaterfall({ holders, classes, exitValue: 12_000_000, vesting: 'normal', asOf: ASOF });
    expect(above.byClass.find((c) => c.classRef === 'a')?.converted).toBe(true);
    const bp = above.breakpoints.find((b) => b.classRef === 'a' && b.event === 'converts');
    expect(bp?.exitValue).toBeCloseTo(10_000_000, -2);
    expect(above.breakpoints.find((b) => b.classRef === 'a' && b.event === 'preference_satisfied')?.exitValue).toBeCloseTo(2_000_000, -2);
  });

  it('participating takes preference then shares pro rata; a cap stops it', () => {
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 8_000_000 }),
      holder({ holderRef: 'inv', shareClassRef: 'a', shares: 2_000_000 }),
    ];
    const classes = [common, seriesA({ participating: true })];
    // Exit 12M: pref 2M, residual 10M shared 20/80 → inv 2M more = 4M, founder 8M.
    const uncapped = computeWaterfall({ holders, classes, exitValue: 12_000_000, vesting: 'normal', asOf: ASOF });
    expect(payout(uncapped, 'inv')).toBeCloseTo(4_000_000, 0);
    expect(payout(uncapped, 'founder')).toBeCloseTo(8_000_000, 0);
    // 2x cap (total $4M incl. preference) at exit 40M: uncapped would be 2M + 20%×38M = 9.6M; capped at 4M, but
    // converting gives 20% × 40M = 8M, so it converts.
    const capped = computeWaterfall({
      holders, classes, exitValue: 40_000_000, vesting: 'normal', asOf: ASOF, participationCaps: { a: 2 },
    });
    expect(payout(capped, 'inv')).toBeCloseTo(8_000_000, 0);
    expect(capped.byClass.find((c) => c.classRef === 'a')?.converted).toBe(true);
    // Exit 15M with the 2x cap: uncapped 2M + 20%×13M = 4.6M > 4M cap → capped at 4M; convert would be 3M.
    const midCapped = computeWaterfall({
      holders, classes, exitValue: 15_000_000, vesting: 'normal', asOf: ASOF, participationCaps: { a: 2 },
    });
    expect(payout(midCapped, 'inv')).toBeCloseTo(4_000_000, 0);
    expect(payout(midCapped, 'founder')).toBeCloseTo(11_000_000, 0);
  });

  it('pays the seniority stack in order', () => {
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 5_000_000 }),
      holder({ holderRef: 'a-inv', shareClassRef: 'a', shares: 2_000_000 }),
      holder({ holderRef: 'b-inv', shareClassRef: 'b', shares: 1_000_000 }),
    ];
    const classes = [
      common,
      seriesA({ seniority: 2 }),
      cls({ classRef: 'b', kind: 'preferred', pricePerShare: 4, liquidationMultiple: 1, seniority: 1 }),
    ];
    // B (senior) claims 4M; A claims 2M. Exit 5M: B 4M, A 1M, founder 0.
    const r = computeWaterfall({ holders, classes, exitValue: 5_000_000, vesting: 'normal', asOf: ASOF });
    expect(payout(r, 'b-inv')).toBeCloseTo(4_000_000, 0);
    expect(payout(r, 'a-inv')).toBeCloseTo(1_000_000, 0);
    expect(payout(r, 'founder')).toBeCloseTo(0, 0);
  });

  it('subtracts debt before any class is paid', () => {
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 8_000_000 }),
      holder({ holderRef: 'inv', shareClassRef: 'a', shares: 2_000_000 }),
    ];
    const r = computeWaterfall({ holders, classes: [common, seriesA()], exitValue: 5_000_000, debt: 4_000_000, vesting: 'normal', asOf: ASOF });
    expect(r.netExit).toBe(1_000_000);
    expect(payout(r, 'inv')).toBeCloseTo(1_000_000, 0);
    expect(payout(r, 'founder')).toBeCloseTo(0, 0);
  });

  it('accelerated vesting counts unvested options; normal does not', () => {
    const options = cls({ classRef: 'pool', kind: 'option-pool', pricePerShare: 0.1 });
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 9_000_000 }),
      holder({ holderRef: 'emp', shareClassRef: 'pool', shares: 1_000_000, vested: 250_000, unvested: 750_000, instrument: 'option' }),
    ];
    const classes = [common, options];
    const normal = computeWaterfall({ holders, classes, exitValue: 10_000_000, vesting: 'normal', asOf: ASOF });
    const accel = computeWaterfall({ holders, classes, exitValue: 10_000_000, vesting: 'accelerated', asOf: ASOF });
    expect(payout(accel, 'emp')).toBeGreaterThan(payout(normal, 'emp'));
    // accelerated: pool = 10M + 100k strike proceeds over 10M shares → $1.01/sh; emp nets 1M×(1.01−0.1)=910k
    expect(payout(accel, 'emp')).toBeCloseTo(910_000, -2);
  });

  it('options out of the money do not exercise', () => {
    const options = cls({ classRef: 'pool', kind: 'option-pool', pricePerShare: 5 });
    const holders = [
      holder({ holderRef: 'founder', shareClassRef: 'common', shares: 9_000_000 }),
      holder({ holderRef: 'emp', shareClassRef: 'pool', shares: 1_000_000, instrument: 'option' }),
    ];
    const r = computeWaterfall({ holders, classes: [common, options], exitValue: 9_000_000, vesting: 'normal', asOf: ASOF });
    expect(payout(r, 'emp')).toBe(0);
    expect(payout(r, 'founder')).toBeCloseTo(9_000_000, 0);
  });
});

describe('sensitivity and goal-seek', () => {
  const holders = [
    holder({ holderRef: 'founder', shareClassRef: 'common', shares: 8_000_000 }),
    holder({ holderRef: 'inv', shareClassRef: 'a', shares: 2_000_000 }),
  ];
  const base = { holders, classes: [common, seriesA()], vesting: 'normal' as const, asOf: ASOF };

  it('maps the function over a range, monotone in exit value', () => {
    const points = sensitivity(base, exitRange(1_000_000, 50_000_000, 6));
    expect(points).toHaveLength(6);
    const founder = points.map((p) => p.byHolder.find((h) => h.partyRef === 'founder')?.payout ?? 0);
    for (let i = 1; i < founder.length; i++) expect(founder[i]!).toBeGreaterThanOrEqual(founder[i - 1]!);
  });

  it('goal-seek converges on the exit that pays the target', () => {
    // Founder 80% of the as-converted exit above 10M: 16M payout → exit 20M.
    const exit = goalSeekExit(base, 'founder', 16_000_000, { maxExit: 100_000_000 });
    expect(exit).not.toBeNull();
    expect(exit!).toBeCloseTo(20_000_000, -2);
  });

  it('goal-seek returns null when unreachable', () => {
    expect(goalSeekExit(base, 'founder', 1_000_000_000, { maxExit: 10_000_000 })).toBeNull();
  });
});
