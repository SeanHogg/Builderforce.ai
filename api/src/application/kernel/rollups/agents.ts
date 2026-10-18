/**
 * The WRITER for `agents.*` metric facts.
 *
 * -- WHY THE USAGE FACTS ARE READ ACROSS DATABASES ---------------------------
 * `llm_usage_log` is the only usage ledger anything writes (every LLM call lands
 * there, on the OPERATIONAL database via `usageDatabaseOf`). The main-database
 * `ai_usage_records` has no writer, so reading it made `agents.tokens` and
 * `agents.cost_cents` permanently zero. `metric_facts` lives on the core
 * database and a statement cannot span two Neon databases, so, like the site
 * metrics in growth.ts, the ledger is aggregated THERE (one grouped query,
 * never row-by-row) and the facts select from the result via {@link rowsTable}.
 *
 * -- BYO COSTS ZERO, AND THAT IS NOT A BUG -----------------------------------
 * A row with `byo` genuinely cost the platform nothing: the tenant paid
 * their vendor directly. So `agents.cost_cents` sums what it sums and the
 * `byo` split rides `dimension_key`. Ranking BYO usage by COST would rank
 * every such tenant at zero, which is why the tokens metric exists beside it.
 */

import { sql } from 'drizzle-orm';
import { fact, resultRows, rowsTable, type DomainRollup, type RowsColumn } from '../metricRollup';
import type { Db } from '../../../infrastructure/database/connection';

const WINDOW_DAYS = 90;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

const USAGE_COLUMNS: readonly RowsColumn[] = [
  { name: 'tenant_id', type: 'int' },
  { name: 'bucket_at', type: 'timestamp' },
  { name: 'vendor', type: 'text' },
  { name: 'byo', type: 'int' },
  { name: 'tokens', type: 'bigint' },
  { name: 'cost_cents', type: 'numeric' },
];

/**
 * The usage ledger aggregated to (tenant, day, vendor, byo) on the operational
 * database. `cost_usd_millicents` is 1/100000 USD, so /1000 gives cents. Null when
 * the ledger is unreachable: a missing source must skip the metric, not take the
 * sweep down (the honesty rule: no zero-fill).
 */
async function usageRows(usage: Db) {
  try {
    return resultRows(await usage.execute(sql`
      SELECT u.tenant_id,
             DATE_TRUNC('day', u.created_at) AS bucket_at,
             COALESCE(u.byo_provider, u.llm_product) AS vendor,
             u.byo::int AS byo,
             SUM(COALESCE(u.prompt_tokens, 0) + COALESCE(u.completion_tokens, 0)) AS tokens,
             SUM(COALESCE(u.cost_usd_millicents, 0)) / 1000.0 AS cost_cents
        FROM llm_usage_log u
       WHERE u.tenant_id IS NOT NULL AND u.created_at >= ${since}
       GROUP BY u.tenant_id, DATE_TRUNC('day', u.created_at), COALESCE(u.byo_provider, u.llm_product), u.byo
    `));
  } catch {
    return null;
  }
}

export const AGENTS_ROLLUP: DomainRollup = {
  domain: 'agents',
  metrics: [
    {
      key: 'agents.runs',
      requires: ['executions'],
      build: () => [
        fact({
          metric: 'agents.runs',
          bucket: 'day',
          unit: 'runs',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', e.created_at)`,
          value: sql`COUNT(*)`,
          tail: sql`
              FROM executions e
             WHERE e.tenant_id IS NOT NULL AND e.created_at >= ${since}
             GROUP BY e.tenant_id, DATE_TRUNC('day', e.created_at)
          `,
        }),
        // The outcome split, as a dimension of the same key: "how many runs" and
        // "how many of them failed" must never be able to disagree, which two
        // separate metrics computed from two separate predicates eventually do.
        fact({
          metric: 'agents.runs',
          bucket: 'day',
          unit: 'runs',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', e.created_at)`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('status', e.status)`,
          dimensionKey: sql`'status:' || e.status`,
          tail: sql`
              FROM executions e
             WHERE e.tenant_id IS NOT NULL AND e.created_at >= ${since}
             GROUP BY e.tenant_id, e.status, DATE_TRUNC('day', e.created_at)
          `,
        }),
      ],
    },
    {
      key: 'agents.tokens',
      requires: [],
      build: async (_present, { usage }) => {
        const rows = await usageRows(usage);
        if (!rows) return null;
        const u = rowsTable('u', USAGE_COLUMNS, rows);
        return fact({
          metric: 'agents.tokens',
          bucket: 'day',
          unit: 'tokens',
          tenant: sql`u.tenant_id`,
          bucketAt: sql`u.bucket_at`,
          // Input AND output. A tokens figure that counted only completions would
          // understate a long-context agent by an order of magnitude, and context
          // is where the cost of this platform actually goes.
          value: sql`SUM(u.tokens)`,
          tail: sql`FROM ${u} GROUP BY u.tenant_id, u.bucket_at`,
        });
      },
    },
    {
      key: 'agents.cost_cents',
      requires: [],
      build: async (_present, { usage }) => {
        const rows = await usageRows(usage);
        if (!rows) return null;
        const u = rowsTable('u', USAGE_COLUMNS, rows);
        return [
          fact({
            metric: 'agents.cost_cents',
            bucket: 'day',
            unit: 'cents',
            tenant: sql`u.tenant_id`,
            bucketAt: sql`u.bucket_at`,
            value: sql`SUM(u.cost_cents)`,
            tail: sql`FROM ${u} GROUP BY u.tenant_id, u.bucket_at`,
          }),
          fact({
            metric: 'agents.cost_cents',
            bucket: 'day',
            unit: 'cents',
            tenant: sql`u.tenant_id`,
            bucketAt: sql`u.bucket_at`,
            value: sql`SUM(u.cost_cents)`,
            dimension: sql`JSONB_BUILD_OBJECT('vendor', u.vendor, 'byo', u.byo = 1)`,
            dimensionKey: sql`'vendor:' || u.vendor || CASE WHEN u.byo = 1 THEN ':byo' ELSE '' END`,
            tail: sql`FROM ${u} GROUP BY u.tenant_id, u.vendor, u.byo, u.bucket_at`,
          }),
        ];
      },
    },
  ],
};
