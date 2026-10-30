import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { codingEvidence, teachesRouting } from './codingEvidence';

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

  it('teachesRouting adds the exclusions: not a stopped run, not a tenant-quota failure', () => {
    const { sql, params } = new PgDialect().sqlToQuery(teachesRouting!);
    expect(sql).toContain('"routing_signal" = $');
    expect(sql).toContain('"terminal_status" <> $');
    expect(sql).toContain('"quota_exhausted" = $');
    expect(params).toEqual([true, 'cancelled', false]);
  });

  /** A source file's code with its imports and comments removed, so a match is a USE, not a mention. */
  const codeOf = (file: string): string =>
    readFileSync(resolve(__dirname, '..', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^import[\s\S]*?;\s*$/gm, '');

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
  ];

  it.each(LENSES)('%s reads coding evidence only', (file) => {
    expect(codeOf(file)).toMatch(/\bcodingEvidence\b/);
  });

  // These decide what the ROUTING TABLE learns, so they read the stricter predicate — a stopped run and a
  // tenant-quota failure are excluded — and a rebuild admits exactly what the live fold admitted.
  const ROUTING_READERS = [
    'llm/routingReconcile.ts',
    'llm/recallSeed.ts',
    'eval/variantEval.ts',
  ];

  it.each(ROUTING_READERS)('%s calls teachesRouting', (file) => {
    expect(codeOf(file)).toMatch(/\bteachesRouting\b/);
  });

  // The live fold gate: the same exclusions, applied to a run as it is recorded.
  const LIVE_FOLD_GATES = ['runtime/recordClientRunOutcome.ts', 'runtime/scoreRunOutcome.ts'];

  it.each(LIVE_FOLD_GATES)('%s gates the routing fold with foldsIntoRouting', (file) => {
    expect(codeOf(file)).toMatch(/\bfoldsIntoRouting\(/);
  });
});
