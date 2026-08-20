/**
 * The WRITER for `agents.*` metric facts.
 *
 * ── WHY `ai_usage_records` AND NOT `llm_usage_log` ──────────────────────────
 * `llm_usage_log` is the richer ledger and it lives on the OPERATIONAL database
 * (`NEON_TRANSACTIONAL_DATABASE_URL`, created by `transactional-migrations/`).
 * `metric_facts` lives on the main one. A rollup is a single
 * `INSERT … SELECT … ON CONFLICT`, and there is no such statement across two
 * Neon databases — so reading the operational ledger here would mean pulling
 * every row into the Worker and writing them back, which is the fan-out
 * anti-pattern this platform rejects outright.
 *
 * `ai_usage_records` is the main-database ledger of the same events —
 * tenant, model, input/output tokens, `cost_cents`, `occurred_at` — and it
 * aggregates in one statement where it already sits. When the two ledgers are
 * finally consolidated this file reads whichever survives; until then it reads
 * the one on the correct side of the seam.
 *
 * ── BYO COSTS ZERO, AND THAT IS NOT A BUG ───────────────────────────────────
 * A row with `is_byo` genuinely cost the platform nothing — the tenant paid
 * their vendor directly — so `agents.cost_cents` sums what it sums and the
 * `is_byo` split rides `dimension_key`. Ranking BYO usage by COST would rank
 * every such tenant at zero, which is why the tokens metric exists beside it.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_DAYS = 90;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

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
      requires: ['ai_usage_records'],
      build: () => fact({
        metric: 'agents.tokens',
        bucket: 'day',
        unit: 'tokens',
        tenant: sql`u.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', u.occurred_at)`,
        // Input AND output. A tokens figure that counted only completions would
        // understate a long-context agent by an order of magnitude, and context
        // is where the cost of this platform actually goes.
        value: sql`SUM(COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0))`,
        tail: sql`
            FROM ai_usage_records u
           WHERE u.tenant_id IS NOT NULL AND u.occurred_at >= ${since}
           GROUP BY u.tenant_id, DATE_TRUNC('day', u.occurred_at)
        `,
      }),
    },
    {
      key: 'agents.cost_cents',
      requires: ['ai_usage_records'],
      build: () => [
        fact({
          metric: 'agents.cost_cents',
          bucket: 'day',
          unit: 'cents',
          tenant: sql`u.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', u.occurred_at)`,
          value: sql`SUM(COALESCE(u.cost_cents, 0))`,
          tail: sql`
              FROM ai_usage_records u
             WHERE u.tenant_id IS NOT NULL AND u.occurred_at >= ${since}
             GROUP BY u.tenant_id, DATE_TRUNC('day', u.occurred_at)
          `,
        }),
        fact({
          metric: 'agents.cost_cents',
          bucket: 'day',
          unit: 'cents',
          tenant: sql`u.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', u.occurred_at)`,
          value: sql`SUM(COALESCE(u.cost_cents, 0))`,
          dimension: sql`JSONB_BUILD_OBJECT('vendor', u.vendor, 'byo', u.is_byo)`,
          dimensionKey: sql`'vendor:' || u.vendor || CASE WHEN u.is_byo THEN ':byo' ELSE '' END`,
          tail: sql`
              FROM ai_usage_records u
             WHERE u.tenant_id IS NOT NULL AND u.occurred_at >= ${since}
             GROUP BY u.tenant_id, u.vendor, u.is_byo, DATE_TRUNC('day', u.occurred_at)
          `,
        }),
      ],
    },
  ],
};
