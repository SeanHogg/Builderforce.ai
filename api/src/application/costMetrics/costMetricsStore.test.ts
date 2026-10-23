import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { readCostMetricRows } from './costMetricsStore';

/** Flatten a drizzle `sql` template into its text (parameters as their values). */
function dump(q: unknown): string {
  const o = q as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(o.queryChunks)) return o.queryChunks.map((c) => (typeof c === 'string' ? c : dump(c))).join('');
  if (Array.isArray(o.value)) return o.value.join('');
  if (o.value !== undefined) return String(o.value);
  return String(q);
}

function capture(rows: unknown[] = []) {
  const sqls: string[] = [];
  const db = { execute: async (q: unknown) => { sqls.push(dump(q).replace(/\s+/g, ' ')); return { rows }; } } as unknown as Db;
  return { db, sqls };
}

describe('readCostMetricRows', () => {
  it('groups by the registry expression and joins outcomes by execution for per-run attribution', async () => {
    const { db, sqls } = capture();
    await readCostMetricRows(db, 7, 30, 'actionType');
    expect(sqls[0]).toContain("COALESCE(o.action_type, 'unattributed') AS group_key");
    expect(sqls[0]).toContain('LEFT JOIN run_model_outcomes o ON o.execution_id = u.execution_id AND o.tenant_id = u.tenant_id');
    expect(sqls[0]).toContain('WHERE u.tenant_id = 7');
    expect(sqls[0]).not.toContain('CROSS JOIN LATERAL');
  });

  it('expands the stamped lever arms for groupBy=lever', async () => {
    const { db, sqls } = capture();
    await readCostMetricRows(db, 7, 7, 'lever');
    expect(sqls[0]).toContain('CROSS JOIN LATERAL');
    expect(sqls[0]).toContain("u.metadata->'costLevers'->'on'");
    expect(sqls[0]).toContain("u.metadata->'costLevers'->'off'");
  });

  it('coerces the driver strings to numbers and keeps absent medians null', async () => {
    const { db } = capture([{
      group_key: 'all', arm: '', calls: '3', prompt_tokens: '900', completion_tokens: '90', cache_read_tokens: '300',
      reasoning_tokens: '0', reasoning_reported_completion: '0', cost_millicents: '1200', median_context_tokens: null,
      completed_runs: null, median_turns: null, merged_runs: null, merged_cost: null, median_merged_cost: null,
    }]);
    const [row] = await readCostMetricRows(db, 7, 7, 'none');
    expect(row).toMatchObject({ calls: 3, promptTokens: 900, cacheReadTokens: 300, costMillicents: 1200, medianContextTokens: null, mergedRuns: 0, medianTurns: null });
  });
});
