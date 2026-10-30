import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { RUN_OUTLIER_MIN_SAMPLES } from './costAlertRules';
import { runOutlierStatement } from './runOutlierStatement';

const render = () => new PgDialect().sqlToQuery(runOutlierStatement(2, 200));

describe('the run cost-outlier statement', () => {
  it('gates the p90 on runs that HAVE a cost: 2 priced + 25 unknown is not a 20-sample history', () => {
    const { sql: text, params } = render();

    // percentile_cont ignores NULL costs, so the gate must count only priced runs.
    expect(text).toContain('HAVING COUNT(o.cost_usd_millicents) >=');
    expect(text).not.toMatch(/HAVING COUNT\(\*\)/);
    expect(params).toContain(RUN_OUTLIER_MIN_SAMPLES);
  });

  it('draws the history from the same population as the judged runs (cloud runs, execution_id set)', () => {
    const { sql: text } = render();
    const [, hist = ''] = text.split('hist AS (');

    expect(hist).toContain('o.execution_id IS NOT NULL');
  });
});
