import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import {
  addUsageToTenantTotals,
  getTenantDayMonthTokens,
  getTenantUsageTotals,
  textTokenWeightOf,
  type UsageRowContribution,
} from './tokenUsage';
import { pickPersistedMetadata } from './usageMetadata';

function countingDb(row: Record<string, number>) {
  const counter = { selects: 0 };
  const db = {
    select: () => ({ from: () => ({ where: () => { counter.selects += 1; return Promise.resolve([row]); } }) }),
  } as unknown as Db;
  return { db, counter };
}

const env = {} as never;
const contribution = (over: Partial<UsageRowContribution> = {}): UsageRowContribution => ({
  llmProduct: 'builderforceLLM', totalTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0,
  byo: false, surface: 'web', paidOverflow: false, premium: false, costUsdMillicents: 0, ...over,
});

describe('cached cap totals', () => {
  it('loads day/month/overflow/premium in ONE statement and serves the rest from cache', async () => {
    const { db, counter } = countingDb({ day: 10, month: 50, overflow: 7, premium: 3 });
    const first = await getTenantUsageTotals(env, db, 1);
    await getTenantUsageTotals(env, db, 1);
    await getTenantDayMonthTokens(env, db, 1);
    expect(counter.selects).toBe(1);
    expect(first).toEqual({ dayTokens: 10, monthTokens: 50, paidOverflowMillicents: 7, premiumMillicents: 3 });
  });

  it('folds a logged row into a warm entry so the caps stay exact', async () => {
    const { db } = countingDb({ day: 10, month: 50, overflow: 7, premium: 3 });
    await getTenantUsageTotals(env, db, 2);
    await addUsageToTenantTotals(env, 2, contribution({ totalTokens: 100, cacheReadTokens: 100, paidOverflow: true, premium: true, costUsdMillicents: 5 }));
    const t = await getTenantUsageTotals(env, db, 2);
    expect(t.dayTokens).toBeCloseTo(20); // 100 cache-read tokens weigh 0.1x
    expect(t.monthTokens).toBeCloseTo(60);
    expect(t.paidOverflowMillicents).toBe(12);
    expect(t.premiumMillicents).toBe(8);
  });

  it('leaves a cold entry alone (the next load already counts the row)', async () => {
    const { db, counter } = countingDb({ day: 1, month: 1, overflow: 0, premium: 0 });
    await addUsageToTenantTotals(env, 3, contribution());
    const t = await getTenantUsageTotals(env, db, 3);
    expect(counter.selects).toBe(1);
    expect(t.dayTokens).toBe(1);
  });

  it('weights rows exactly as the SQL billable predicate does', () => {
    expect(textTokenWeightOf(contribution({ llmProduct: 'builderforceImage' }))).toBe(0);
    expect(textTokenWeightOf(contribution({ byo: true, surface: 'vsix' }))).toBe(0);
    expect(textTokenWeightOf(contribution({ byo: true, surface: 'web' }))).toBe(100);
  });
});

describe('persisted metadata denylist', () => {
  it('keeps trace-back keys, drops guest prompt text, bounds size', () => {
    const kept = pickPersistedMetadata({
      chatId: 4, mode: 'work', memory: { trimmedTokens: 5 }, taskId: 9,
      agentRef: 'a1', cloudAgentRef: 'c1', step: 3, orderId: 'o-7',
      guestTurnInput: 'private prompt', guestTurnId: 'abc', guestAnything: 'x',
      long: 'x'.repeat(500), huge: { blob: 'y'.repeat(2000) },
    });
    expect(kept).toMatchObject({ chatId: 4, mode: 'work', memory: { trimmedTokens: 5 }, taskId: 9, agentRef: 'a1', cloudAgentRef: 'c1', step: 3, orderId: 'o-7' });
    expect(kept).not.toHaveProperty('guestTurnInput');
    expect(kept).not.toHaveProperty('guestTurnId');
    expect(kept).not.toHaveProperty('guestAnything');
    expect(kept).not.toHaveProperty('huge');
    expect((kept!.long as string).length).toBe(256);
    expect(pickPersistedMetadata({ guestTurnInput: 'x' })).toBeNull();
    expect(pickPersistedMetadata(null)).toBeNull();
  });

  it('caps the number of keys', () => {
    const bag = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(pickPersistedMetadata(bag)!)).toHaveLength(32);
  });
});

describe('totals lifetime', () => {
  it('increments do not extend the reload deadline; a stale entry reloads', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
      const { db, counter } = countingDb({ day: 10, month: 50, overflow: 0, premium: 0 });
      await getTenantUsageTotals(env, db, 9);
      vi.advanceTimersByTime(10_000);
      await addUsageToTenantTotals(env, 9, contribution({ totalTokens: 100 }));
      vi.advanceTimersByTime(30_000); // 40 s: past the 15 s L1 ttl, so only the increment's remaining-life ttl keeps it
      expect((await getTenantUsageTotals(env, db, 9)).dayTokens).toBe(110);
      expect(counter.selects).toBe(1);
      vi.advanceTimersByTime(25_000); // 65 s after load; the increment at 10 s must not have renewed it
      await getTenantUsageTotals(env, db, 9);
      expect(counter.selects).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
