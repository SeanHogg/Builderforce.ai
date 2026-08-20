import { describe, it, expect } from 'vitest';
import { enforceFeedbackSubmissionsCap, sumTenantFeedbackSubmissions } from './feedbackLedger';
import type { Db } from '../../infrastructure/database/connection';

/** Same chainable drizzle mock shape as errorEventsLedger.test.ts. */
function mockDb(queue: unknown[][]): Db {
  let i = 0;
  const take = () => (i < queue.length ? queue[i++] : []);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(take()),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject),
  };
  return { select: () => chain } as unknown as Db;
}

describe('sumTenantFeedbackSubmissions', () => {
  it('floors and clamps the count', async () => {
    expect(await sumTenantFeedbackSubmissions(mockDb([[{ used: 42 }]]), 1, new Date())).toBe(42);
    expect(await sumTenantFeedbackSubmissions(mockDb([[{ used: null }]]), 1, new Date())).toBe(0);
  });
});

describe('enforceFeedbackSubmissionsCap', () => {
  it('free tenant under the monthly cap → allowed', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 10 }],
    ]);
    expect(await enforceFeedbackSubmissionsCap(db, 1)).toEqual({ allowed: true });
  });

  it('free tenant over the cap → refused with the plan and the numbers', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 200 }],
    ]);
    const r = await enforceFeedbackSubmissionsCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.effectivePlan).toBe('free');
      expect(r.limit).toBe(200);
      expect(r.used).toBe(200);
    }
  });

  it('teams tenant → unlimited, allowed without a usage scan', async () => {
    const db = mockDb([[{ plan: 'teams', billingStatus: 'active', trialEndsAt: null, tokenDailyLimitOverride: null }]]);
    expect(await enforceFeedbackSubmissionsCap(db, 1)).toEqual({ allowed: true });
  });

  it('fails OPEN when the accounting query throws', async () => {
    // A metering hiccup must never swallow a customer's request — losing feedback
    // is the one failure this pillar exists to prevent.
    const broken = { select: () => { throw new Error('neon: connection reset'); } } as unknown as Db;
    expect(await enforceFeedbackSubmissionsCap(broken, 1)).toEqual({ allowed: true });
  });
});
