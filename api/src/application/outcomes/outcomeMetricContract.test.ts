import { describe, expect, it } from 'vitest';
import {
  NORTH_STAR_METRIC_KEY,
  OUTCOME_METRICS,
  OUTCOME_METRIC_FAMILIES,
  outcomeAggregateSql,
  outcomeFactsSql,
  toOutcomeMetricValues,
  type OutcomeFact,
} from './outcomeMetricContract';
import { sql } from 'drizzle-orm';

const spec = (key: string) => {
  const found = OUTCOME_METRICS.find((metric) => metric.key === key);
  if (!found) throw new Error(`no metric ${key}`);
  return found;
};

/**
 * The literal SQL text of a drizzle fragment. Bound parameters are irrelevant
 * here — these assertions are about the SHAPE of the query the contract emits,
 * which is the part two hand-written copies used to get subtly different.
 */
function sqlText(fragment: { queryChunks?: unknown[] }): string {
  return (fragment.queryChunks ?? [])
    .map((chunk) => {
      if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) return sqlText(chunk as { queryChunks: unknown[] });
      const value = (chunk as { value?: unknown })?.value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
}

/** A fact row with every counter at zero, so each test states only what it means. */
const fact = (overrides: Record<string, unknown> = {}): OutcomeFact => ({ id: 'session-1', ...overrides });

describe('outcome metric contract', () => {
  it('names exactly one north star, and it is the graded-proof rate', () => {
    const flagged = OUTCOME_METRICS.filter((metric) => metric.northStar);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.key).toBe('gradedProofRate');
    expect(NORTH_STAR_METRIC_KEY).toBe('gradedProofRate');
  });

  it('files every metric under a declared family', () => {
    for (const metric of OUTCOME_METRICS) {
      expect(OUTCOME_METRIC_FAMILIES).toContain(metric.family);
      expect(metric.definition.length).toBeGreaterThan(20);
    }
  });

  it('counts an idea as reaching a graded proof only once a kill condition was measured', () => {
    // Built and even delivered, but nobody graded it: this is the case the
    // north star exists to distinguish from a launch with extra steps.
    expect(spec('gradedProofRate').session(fact({ proofs_built: 2, deliveries: 3 }))).toBe(0);
    expect(spec('gradedProofRate').session(fact({ proofs_built: 2, proofs_graded: 1 }))).toBe(1);
  });

  it('grades proofs against the proofs actually built', () => {
    expect(spec('proofGradingRate').session(fact({ proofs_built: 4, proofs_graded: 1 }))).toBe(.25);
    // No proof built is not a 0% grading rate — it is nothing to report.
    expect(spec('proofGradingRate').session(fact())).toBeNull();
  });

  it('measures Read-before-Build only for ideas that started a build', () => {
    const readFirst = spec('readBeforeBuildRate');
    expect(readFirst.session(fact({ built_any: true, read_before_build: true }))).toBe(1);
    expect(readFirst.session(fact({ built_any: true, read_before_build: false }))).toBe(0);
    expect(readFirst.session(fact({ built_any: false, read_before_build: true }))).toBeNull();
  });

  it('counts a proof as reachable only when the build produced an address', () => {
    expect(spec('reachableProofRate').session(fact({ proof_attempts: 2, proofs_reachable: 1 }))).toBe(.5);
    expect(spec('reachableProofRate').session(fact())).toBeNull();
  });

  it('reports an unmeasured rate as null rather than zero', () => {
    // A cost nobody reported is not a free delivery, and an empty validation
    // set is not a 0% pass rate.
    expect(spec('costPerDelivery').session(fact({ deliveries: 0, cost_millicents: 500 }))).toBeNull();
    expect(spec('validationRate').session(fact())).toBeNull();
    expect(spec('deliverySuccessRate').session(fact())).toBeNull();
    expect(spec('synthesisRate').session(fact())).toBeNull();
  });

  it('excludes proof grading from the artifact validation pass rate', () => {
    // A missed kill condition is a finding, not a broken artifact — the facts
    // CTE filters it out, so the metric can never be dragged down by one.
    const query = sqlText(outcomeFactsSql(sql`SELECT id, tenant_id, created_at FROM creation_sessions`));
    expect(query).toContain("e.phase = 'validated' AND e.action <> 'proof.grade'");
  });

  it('aggregates under the metric keys, so a rollup row needs no second mapping', () => {
    const aggregate = sqlText(outcomeAggregateSql());
    for (const metric of OUTCOME_METRICS) expect(aggregate).toContain(`"${metric.key}"`);
    expect(aggregate).toContain('"sessionCount"');
    expect(aggregate).toContain('"gradedSessions"');
  });

  it('carries family, direction and the north-star flag onto every reported value', () => {
    const values = toOutcomeMetricValues(() => 1, () => null);
    expect(values).toHaveLength(OUTCOME_METRICS.length);
    const northStar = values.find((value) => value.northStar);
    expect(northStar?.key).toBe('gradedProofRate');
    expect(values.every((value) => value.family && value.unit && value.direction)).toBe(true);
  });
});
