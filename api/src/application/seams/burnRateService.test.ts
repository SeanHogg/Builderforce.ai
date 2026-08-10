import { describe, expect, it } from 'vitest';
import { fetchBurnRate } from './burnRateService';

function makeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) chain[method] = () => chain;
  chain.limit = async () => rows;
  return { select: () => chain } as any;
}

describe('fetchBurnRate', () => {
  it('returns no_data when Builderforce has no local finance facts', async () => {
    expect(await fetchBurnRate(makeDb([]), { tenantId: 1, segmentId: 'seg' }))
      .toEqual({ available: false, reason: 'no_data' });
  });

  it('returns the newest local burn and runway metrics', async () => {
    const at = new Date('2026-08-10T12:00:00.000Z');
    const result = await fetchBurnRate(makeDb([
      { metric: 'finance.burn', value: '50000.000000', bucketAt: at, computedAt: at },
      { metric: 'finance.runway_months', value: '8.250000', bucketAt: at, computedAt: at },
      { metric: 'finance.burn', value: '49000.000000', bucketAt: new Date('2026-07-10'), computedAt: new Date('2026-07-10') },
    ]), { tenantId: 1, segmentId: 'seg' });

    expect(result).toEqual({
      available: true,
      source: 'builderforce',
      monthlyBurn: 50000,
      runwayMonths: 8.25,
      asOf: at.toISOString(),
    });
  });

  it('returns a partial local snapshot when only one metric exists', async () => {
    const at = new Date('2026-08-10T12:00:00.000Z');
    expect(await fetchBurnRate(makeDb([
      { metric: 'finance.runway_months', value: '4', bucketAt: at, computedAt: at },
    ]), { tenantId: 2, segmentId: 'seg-2' })).toEqual({
      available: true, source: 'builderforce', runwayMonths: 4, asOf: at.toISOString(),
    });
  });
});
