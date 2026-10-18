import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { fetchBurnRate } from './burnRateService';
import type { Db } from '../../infrastructure/database/connection';

/** Queue: the runway report's observed facts read, then its companies read. */
const dbWith = (facts: unknown[]) => fakeDb([facts, []]) as unknown as Db;

describe('fetchBurnRate — the runway report observed headline', () => {
  it('returns no_data when Builderforce has no local finance facts', async () => {
    expect(await fetchBurnRate(dbWith([]), undefined, 1)).toEqual({ available: false, reason: 'no_data' });
  });

  it('returns the newest local burn and runway metrics', async () => {
    const at = new Date('2026-08-10T12:00:00.000Z');
    const result = await fetchBurnRate(dbWith([
      { metric: 'finance.burn', value: '50000.000000', bucketAt: at, computedAt: at },
      { metric: 'finance.runway_months', value: '8.250000', bucketAt: at, computedAt: at },
      { metric: 'finance.burn', value: '49000.000000', bucketAt: new Date('2026-07-10'), computedAt: new Date('2026-07-10') },
    ]), undefined, 1);
    expect(result).toEqual({ available: true, source: 'builderforce', monthlyBurn: 50000, runwayMonths: 8.25, asOf: at.toISOString() });
  });

  it('prefers finance.monthly_burn over finance.burn, exactly as the runway page does', async () => {
    const at = new Date('2026-08-10T12:00:00.000Z');
    const result = await fetchBurnRate(dbWith([
      { metric: 'finance.burn', value: '50000', bucketAt: at, computedAt: at },
      { metric: 'finance.monthly_burn', value: '42000', bucketAt: at, computedAt: at },
    ]), undefined, 1);
    expect(result.monthlyBurn).toBe(42000);
  });

  it('returns a partial local snapshot when only one metric exists', async () => {
    const at = new Date('2026-08-10T12:00:00.000Z');
    expect(await fetchBurnRate(dbWith([
      { metric: 'finance.runway_months', value: '4', bucketAt: at, computedAt: at },
    ]), undefined, 2)).toEqual({ available: true, source: 'builderforce', runwayMonths: 4, asOf: at.toISOString() });
  });
});
