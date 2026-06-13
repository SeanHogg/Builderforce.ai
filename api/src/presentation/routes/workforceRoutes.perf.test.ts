import { describe, expect, it } from 'vitest';
import { loadAgentPerfRollup } from './workforceRoutes';

type SqlClient = Parameters<typeof loadAgentPerfRollup>[0];

/**
 * Locks the gap [1247] owner-only perf rollup math: success rate over terminal
 * runs, latency rounding, rating averaging, and the null cases when there is no
 * telemetry/feedback. The three SQL reads (perf / hires / feedback) are stubbed by
 * a tagged-template that returns canned rows in call order, so this exercises the
 * reduction logic without a live DB.
 */
function mockSql(responses: unknown[][]): SqlClient {
  let i = 0;
  const fn = ((..._args: unknown[]) => Promise.resolve(responses[i++] ?? [])) as unknown as SqlClient;
  return fn;
}

describe('loadAgentPerfRollup', () => {
  it('computes success rate, latency, and rating averages', async () => {
    const sql = mockSql([
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
    const sql = mockSql([
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
