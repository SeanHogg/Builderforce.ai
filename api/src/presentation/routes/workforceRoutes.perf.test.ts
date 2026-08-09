import { describe, expect, it } from 'vitest';
import { loadAgentPerfRollup } from './workforceRoutes';

type Db = Parameters<typeof loadAgentPerfRollup>[0];

/**
 * Locks the gap [1247] owner-only perf rollup math: success rate over terminal
 * runs, latency rounding, rating averaging, and the null cases when there is no
 * telemetry/feedback. The three reads (perf / hires / feedback) are stubbed by a
 * minimal Drizzle fake that returns canned rows in call order, so this exercises
 * the reduction logic without a live DB.
 *
 * Every rollup read uses the Drizzle query builder:
 *   db.select(…).from(t).where(…)[.orderBy(…).limit(n)] -> rows
 * The builder chain is a single self-returning thenable, so it resolves off the
 * same call-ordered queue no matter which terminal method the query ends on.
 */
function mockDb(responses: unknown[][]): Db {
  let i = 0;
  const take = () => Promise.resolve(responses[i++] ?? []);
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => take().then(onOk, onErr);
  return { select: () => chain } as unknown as Db;
}

describe('loadAgentPerfRollup', () => {
  it('computes success rate, latency, and rating averages', async () => {
    const sql = mockDb([
      [{ total_runs: 10, completed_runs: 7, failed_runs: 3, avg_latency_ms: 4200.6 }],
      [{ hired_tenants: 4 }],
      [
        { rating: 5, comment: 'great', created_at: '2026-06-12T00:00:00Z' },
        { rating: 3, comment: null, created_at: '2026-06-11T00:00:00Z' },
      ],
    ]);

    const r = await loadAgentPerfRollup(sql, 'agent-1');

    expect(r.totalRuns).toBe(10);
    expect(r.completedRuns).toBe(7);
    expect(r.failedRuns).toBe(3);
    expect(r.successRate).toBeCloseTo(0.7);   // 7 / (7+3)
    expect(r.avgLatencyMs).toBe(4201);        // rounded
    expect(r.hiredTenants).toBe(4);
    expect(r.ratingCount).toBe(2);
    expect(r.avgRating).toBeCloseTo(4);        // (5+3)/2
    expect(r.feedback).toHaveLength(2);
    expect(r.feedback[0]).toEqual({ rating: 5, comment: 'great', createdAt: '2026-06-12T00:00:00Z' });
  });

  it('returns null metrics when there are no terminal runs or feedback', async () => {
    const sql = mockDb([
      [{ total_runs: 0, completed_runs: 0, failed_runs: 0, avg_latency_ms: null }],
      [{ hired_tenants: 0 }],
      [],
    ]);

    const r = await loadAgentPerfRollup(sql, 'agent-2');

    expect(r.successRate).toBeNull();
    expect(r.avgLatencyMs).toBeNull();
    expect(r.avgRating).toBeNull();
    expect(r.ratingCount).toBe(0);
    expect(r.feedback).toEqual([]);
  });
});
