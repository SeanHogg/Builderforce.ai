import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { codingEvidence } from './codingEvidence';

/**
 * `routing_signal` means "this row is coding-run evidence". A telemetry-only report (a
 * Creation Canvas turn) must not move any lens that ranks models or measures coding
 * effectiveness — merge rate, score, steps per run, cost per merged run.
 */
describe('codingEvidence', () => {
  it('is routing_signal = TRUE', () => {
    const { sql, params } = new PgDialect().sqlToQuery(codingEvidence);
    expect(sql).toContain('"routing_signal" = $');
    expect(params).toEqual([true]);
  });

  // Each of these reads run_model_outcomes to say how well agents CODE. A new lens of that kind
  // is added here, and fails here until it reads through the predicate.
  const LENSES = [
    'insights/engineeringInsights.ts',
    'insights/aiImpactInsights.ts',
    'insights/builderInsights.ts',
    'insights/spaceMetrics.ts',
    'pmo/portfolioRollup.ts',
    'qa/QaQualityService.ts',
    'tools/toolDataProviders.ts',
    'llm/recallSeed.ts',
    'eval/variantEval.ts',
    'llm/routingTable.ts',
  ];

  it.each(LENSES)('%s reads coding evidence only', (file) => {
    const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
    expect(source).toContain('codingEvidence');
  });
});
