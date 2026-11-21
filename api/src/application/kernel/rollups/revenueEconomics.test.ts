import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { REVENUE_ECONOMICS_METRICS, REVENUE_ECONOMICS_ROLLUP } from './revenueEconomics';
import { REVENUE_ROLLUP } from './revenue';
import { DOMAIN_MANIFEST } from '../DomainService';
import type { PresentTables, RollupSources } from '../metricRollup';

const dialect = new PgDialect();
const render = (statement: SQL): string => dialect.sqlToQuery(statement).sql.replace(/\s+/g, ' ');
const SOURCES = {} as RollupSources;
const ALL: PresentTables = new Set(['invoice_line_items', 'invoices', 'ledger_entries']);

const KEYS = [
  'revenue.mrr', 'revenue.newMrr', 'revenue.expansionMrr', 'revenue.contractionMrr',
  'revenue.churnedMrr', 'revenue.customers', 'revenue.customersLost',
];

async function statementFor(key: string): Promise<string> {
  const spec = REVENUE_ECONOMICS_METRICS.find((m) => m.key === key)!;
  const built = await spec.build(ALL, SOURCES);
  const one = Array.isArray(built) ? built[0]! : built!;
  return render(one);
}

describe('revenue economics rollup', () => {
  it('writes the seven revenue.* roll-forward keys, all declared by the revenue seat', () => {
    expect(REVENUE_ECONOMICS_METRICS.map((m) => m.key)).toEqual(KEYS);
    for (const key of KEYS) expect(DOMAIN_MANIFEST.revenue.metrics).toContain(key);
  });

  it('is part of the one revenue DomainRollup, without duplicating a key', () => {
    expect(REVENUE_ECONOMICS_ROLLUP.domain).toBe('revenue');
    const keys = REVENUE_ROLLUP.metrics.map((m) => m.key);
    for (const key of KEYS) expect(keys.filter((k) => k === key)).toHaveLength(1);
  });

  it('reads recurring plan lines per customer and never zero-fills', async () => {
    const text = await statementFor('revenue.mrr');
    expect(text).toContain('INSERT INTO metric_facts');
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain("li.source_kind = 'plan'");
    expect(text).toContain('inv.customer_ref');
    expect(text).toContain('GROUP BY m.tenant_id, m.at');
  });

  it('classifies each movement against the previous month', async () => {
    expect(await statementFor('revenue.newMrr')).toContain('m.prev = 0 AND m.cur > 0');
    expect(await statementFor('revenue.expansionMrr')).toContain('m.prev > 0 AND m.cur > m.prev');
    expect(await statementFor('revenue.contractionMrr')).toContain('m.cur < m.prev');
    expect(await statementFor('revenue.churnedMrr')).toContain('m.prev > 0 AND m.cur = 0');
    expect(await statementFor('revenue.customersLost')).toContain('m.prev > 0 AND m.cur = 0');
  });

  it('skips cleanly when a source table is absent', () => {
    for (const spec of REVENUE_ECONOMICS_METRICS) {
      expect(spec.requires).toEqual(['invoice_line_items', 'invoices', 'ledger_entries']);
    }
  });
});
