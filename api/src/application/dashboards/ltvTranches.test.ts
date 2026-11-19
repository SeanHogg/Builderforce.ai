import { describe, expect, it } from 'vitest';
import {
  computeBlendedLtv,
  computeLtvTranches,
  nextActionTranche,
  UNASSIGNED_TRANCHE,
  type CustomerEconomicsRow,
} from './ltvTranches';

const row = (over: Partial<CustomerEconomicsRow>): CustomerEconomicsRow => ({
  id: 'c',
  plan: 'pro',
  cohortMonth: '2026-01',
  channel: 'organic',
  segment: 'smb',
  arpa: 100,
  marginPct: 80,
  churnPct: 2,
  cac: 400,
  ...over,
});

describe('computeLtvTranches', () => {
  it('disagrees with the blended figure: one healthy and one leaky tranche', () => {
    const rows = [
      row({ id: 'a', plan: 'enterprise', arpa: 1000, marginPct: 80, churnPct: 1, cac: 4000 }),
      row({ id: 'b', plan: 'starter', arpa: 20, marginPct: 80, churnPct: 8, cac: 150 }),
    ];
    const tranches = computeLtvTranches(rows, { dimension: 'plan' });
    const enterprise = tranches.find((t) => t.tranche === 'enterprise')!;
    const starter = tranches.find((t) => t.tranche === 'starter')!;
    expect(enterprise.ltv).toBeCloseTo(80_000);
    expect(enterprise.ratio).toBeCloseTo(20);
    expect(starter.ltv).toBeCloseTo(200);
    expect(starter.ratio).toBeCloseTo(200 / 150);

    const blended = computeBlendedLtv(rows);
    // The blend hides the leaky pocket: it clears 3:1 while starter is below it.
    expect(blended.ratio).not.toBeNull();
    expect(blended.ratio!).toBeGreaterThan(3);
    expect(starter.ratio!).toBeLessThan(3);
    expect(nextActionTranche(tranches)).toEqual({ tranche: 'starter', ratio: 200 / 150 });
    // Worst ratio leads the chart.
    expect(tranches[0]!.tranche).toBe('starter');
  });

  it('returns null LTV, ratio and nothing else invented on zero churn', () => {
    const [t] = computeLtvTranches([row({ churnPct: 0 })], { dimension: 'plan' });
    expect(t!.ltv).toBeNull();
    expect(t!.ratio).toBeNull();
    // Payback does not depend on churn, so it is still measured.
    expect(t!.paybackMonths).toBeCloseTo(400 / 80);
  });

  it('returns null — never 0 — when churn or CAC is missing or CAC is zero', () => {
    const [noChurn] = computeLtvTranches([row({ churnPct: null })], { dimension: 'plan' });
    expect(noChurn!.ltv).toBeNull();
    const [zeroCac] = computeLtvTranches([row({ cac: 0 })], { dimension: 'plan' });
    expect(zeroCac!.ratio).toBeNull();
    const [noCac] = computeLtvTranches([row({ cac: null })], { dimension: 'plan' });
    expect(noCac!.cac).toBeNull();
    expect(noCac!.paybackMonths).toBeNull();
  });

  it('propagates the declared flag when any member of the tranche is declared', () => {
    const tranches = computeLtvTranches(
      [
        row({ id: 'a', plan: 'pro', declared: false }),
        row({ id: 'b', plan: 'pro', declared: true }),
        row({ id: 'c', plan: 'team', declared: false }),
      ],
      { dimension: 'plan' },
    );
    expect(tranches.find((t) => t.tranche === 'pro')!.declared).toBe(true);
    expect(tranches.find((t) => t.tranche === 'team')!.declared).toBe(false);
  });

  it('groups by each dimension and files a missing value under unassigned', () => {
    const rows = [
      row({ id: 'a', channel: 'ads', segment: 'smb', cohortMonth: '2026-02' }),
      row({ id: 'b', channel: null, segment: 'enterprise', cohortMonth: '2026-01' }),
    ];
    expect(computeLtvTranches(rows, { dimension: 'channel' }).map((t) => t.tranche).sort())
      .toEqual(['ads', UNASSIGNED_TRANCHE].sort());
    expect(computeLtvTranches(rows, { dimension: 'segment' })).toHaveLength(2);
    // Cohorts read chronologically.
    expect(computeLtvTranches(rows, { dimension: 'cohort' }).map((t) => t.tranche)).toEqual(['2026-01', '2026-02']);
  });

  it('names no next action when every tranche clears 3:1', () => {
    expect(nextActionTranche(computeLtvTranches([row({})], { dimension: 'plan' }))).toBeNull();
  });
});
