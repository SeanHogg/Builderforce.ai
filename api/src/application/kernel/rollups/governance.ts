/**
 * The WRITER for `governance.*` metric facts.
 *
 * ── ONE DEFINITION OF "PASSING", SHARED WITH THE AUDIT ──────────────────────
 * `governance.controls_passing` counts the same statuses `AuditRunner`'s
 * governance signal counts, from `application/governance/controlStatus.ts`. A
 * second list here would let the compliance CHART and the compliance REPORT
 * disagree about the same control with no way for a reader to tell which one
 * was wrong — see that module's header.
 *
 * ── FINDINGS ARE UNIONED, NOT SPLIT ─────────────────────────────────────────
 * Security's open findings arrive from two scanners — dependency/code
 * (`vulnerability_findings`) and exploratory QA (`qa_findings`) — and nobody
 * asks "how many dependency findings"; they ask "what is still open against us".
 * So it is ONE key with the source as a `dimension_key`, the same shape
 * `legal.renewals_due` uses across its three registers.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup, type PresentTables } from '../metricRollup';
import { IMPLEMENTED_CONTROL_STATUSES } from '../../governance/controlStatus';

const PASSING = sql.join(
  IMPLEMENTED_CONTROL_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

/** Terminal finding states — a fixed finding is not an open one. */
const CLOSED = sql`('resolved', 'fixed', 'closed', 'dismissed', 'accepted', 'false_positive')`;

function findingRows(present: PresentTables) {
  const parts = [];
  if (present.has('vulnerability_findings')) {
    parts.push(sql`
      SELECT f.tenant_id, 'vulnerability' AS source, LOWER(COALESCE(f.severity, 'unknown')) AS severity
        FROM vulnerability_findings f
       WHERE f.tenant_id IS NOT NULL AND LOWER(COALESCE(f.status, 'open')) NOT IN ${CLOSED}
    `);
  }
  if (present.has('qa_findings')) {
    parts.push(sql`
      SELECT q.tenant_id, 'qa' AS source, LOWER(COALESCE(q.severity, 'unknown')) AS severity
        FROM qa_findings q
       WHERE q.tenant_id IS NOT NULL AND LOWER(COALESCE(q.status, 'open')) NOT IN ${CLOSED}
    `);
  }
  return parts.length ? sql.join(parts, sql` UNION ALL `) : null;
}

export const GOVERNANCE_ROLLUP: DomainRollup = {
  domain: 'governance',
  metrics: [
    {
      key: 'governance.controls_passing',
      requires: ['soc_controls'],
      build: () => [
        // Bucketed on TODAY: a control register has no history of its own —
        // `status` is the current state and carries no transition date — so the
        // only day this pass can honestly speak for is the one it ran on.
        fact({
          metric: 'governance.controls_passing',
          bucket: 'day',
          unit: 'controls',
          tenant: sql`c.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`COUNT(*) FILTER (WHERE LOWER(c.status) IN (${PASSING}))`,
          tail: sql`FROM soc_controls c WHERE c.tenant_id IS NOT NULL GROUP BY c.tenant_id`,
        }),
        // The denominator, as a slice of the same key. "41 passing" means
        // nothing without "of how many", and publishing the total as a second
        // metric is how the two end up computed from two different registers.
        fact({
          metric: 'governance.controls_passing',
          bucket: 'day',
          unit: 'controls',
          tenant: sql`c.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('scope', 'total')`,
          dimensionKey: sql`'scope:total'`,
          tail: sql`FROM soc_controls c WHERE c.tenant_id IS NOT NULL GROUP BY c.tenant_id`,
        }),
      ],
    },
    {
      key: 'governance.open_findings',
      requires: [],
      build: (present) => {
        const rows = findingRows(present);
        if (!rows) return null;
        return [
          fact({
            metric: 'governance.open_findings',
            bucket: 'day',
            unit: 'findings',
            tenant: sql`f.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            tail: sql`FROM (${rows}) AS f GROUP BY f.tenant_id`,
          }),
          // By severity, because "eleven open findings" is not actionable and
          // "one critical" is — and a security tile that cannot say which is a
          // tile nobody opens twice.
          fact({
            metric: 'governance.open_findings',
            bucket: 'day',
            unit: 'findings',
            tenant: sql`f.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            dimension: sql`JSONB_BUILD_OBJECT('severity', f.severity)`,
            dimensionKey: sql`'severity:' || f.severity`,
            tail: sql`FROM (${rows}) AS f GROUP BY f.tenant_id, f.severity`,
          }),
        ];
      },
    },
  ],
};
