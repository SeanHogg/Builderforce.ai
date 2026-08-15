/**
 * The WRITER for `legal.*` metric facts.
 *
 * ── WHY THE SEAT ARRIVES WITH THIS ───────────────────────────────────────────
 * `financeRollup.ts` records the defect it was built to close: `DOMAIN_MANIFEST`
 * declared three finance metrics, three surfaces read them by name, and nothing
 * on the platform ever INSERTED one — a live promise over an empty read.
 * `operationsRollup.ts` says the same thing about the sixteenth seat. Adding a
 * seventeenth with two declared metrics and no writer would be recreating that
 * defect knowingly, on the day it is quoted twice. So:
 *
 *   • `legal.open_matters`  — matters not yet closed, daily. What counsel opens
 *     the morning on.
 *   • `legal.renewals_due`  — entity standings, jurisdiction registrations and
 *     IP rights whose renewal falls inside the next ninety days, daily. The
 *     single most valuable number a legal register produces, because every one
 *     of these lapses QUIETLY and the first symptom is a penalty.
 *
 * ── ONE METRIC OVER THREE TABLES ─────────────────────────────────────────────
 * `renewals_due` is a UNION across entities, registrations and IP rather than
 * three metrics, and the reason is the question: nobody asks "how many trademark
 * renewals" — they ask "what lapses this quarter". Three keys would make the
 * answer a sum somebody has to remember to compute, and the per-kind breakdown
 * is a DIMENSION of the same metric, which is what `dimension_key` is for.
 *
 * ── THE RULE THAT KEEPS THE NUMBERS HONEST ───────────────────────────────────
 * Same as the other two rollups: a fact is written only where rows exist, and
 * there is no zero-fill. `trigger` objects fire on these keys, and writing a 0
 * for a tenant that has simply never recorded a matter turns an absent number
 * into an assertion.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────
 * Two statements, each a grouped aggregate upserting on `uq_metric_facts_point`.
 * No per-tenant fan-out and no N+1; the sweep is work-gated upstream, so an idle
 * workspace costs nothing.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

export interface LegalRollupResult {
  /** metric key → rows upserted. */
  written: Record<string, number>;
  facts: number;
  /** Metrics skipped because their source table is absent in this environment. */
  skipped: string[];
}

/** How far ahead a renewal counts as "due". A quarter is the shortest window in
 *  which a lapsed registration can still be fixed without a penalty in most
 *  jurisdictions — a 30-day warning is a notification, not a chance to act. */
const RENEWAL_HORIZON_DAYS = 90;

/** How many days of open-matter history each pass recomputes. */
const WINDOW_DAYS = 90;

/** Terminal matter states. A settled or closed matter is not open, and counting
 *  one is how a cleared desk looks like a busy one. */
const CLOSED = ['settled', 'closed'] as const;

async function tableExists(db: Db, table: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`);
  const rows = (result as unknown as { rows?: Array<{ present?: boolean }> }).rows ?? [];
  return rows[0]?.present === true;
}

function rowCount(result: unknown): number {
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

/**
 * Recompute the legal series into `metric_facts`.
 *
 * Idempotent: every statement upserts on `(tenant_id, metric, bucket, bucket_at,
 * dimension_key)`, so running twice in a day corrects rather than doubles.
 */
export async function runLegalRollup(db: Db): Promise<LegalRollupResult> {
  const written: Record<string, number> = {};
  const skipped: string[] = [];

  if (await tableExists(db, 'legal_matters')) {
    // Bucketed on the day the matter was OPENED rather than on today, so the
    // series is a recomputable history — the same argument `finance.cash` makes
    // for a running balance and `operations.open_work_orders` repeats.
    const open = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT m.tenant_id,
             'legal.open_matters',
             'day',
             DATE_TRUNC('day', COALESCE(m.opened_at::timestamp, m.created_at)),
             '',
             COUNT(*),
             'matters',
             NOW()
        FROM legal_matters m
       WHERE m.tenant_id IS NOT NULL
         AND m.status NOT IN (${sql.join(CLOSED.map((s) => sql`${s}`), sql`, `)})
         AND COALESCE(m.opened_at::timestamp, m.created_at) >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
       GROUP BY m.tenant_id, DATE_TRUNC('day', COALESCE(m.opened_at::timestamp, m.created_at))
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);
    written['legal.open_matters'] = rowCount(open);
  } else {
    skipped.push('legal.open_matters (legal_matters absent)');
  }

  // ── Renewals, across all three registers ──────────────────────────────────
  //
  // The per-kind breakdown rides `dimension_key` on the SAME metric, so "what
  // lapses this quarter" is one series and "which of them are trademarks" is a
  // slice of it — rather than three keys a reader has to know to add up.
  const registers: ReadonlyArray<{ table: string; kind: string }> = [
    { table: 'legal_entities', kind: 'entity' },
    { table: 'legal_registrations', kind: 'registration' },
    { table: 'intellectual_property', kind: 'ip' },
  ];
  const present = [];
  for (const register of registers) {
    if (await tableExists(db, register.table)) present.push(register);
    else skipped.push(`legal.renewals_due/${register.kind} (${register.table} absent)`);
  }

  if (present.length) {
    // Bucketed on TODAY, deliberately and unlike the metric above: "what is due
    // in the next ninety days" is a statement about now, and back-dating it onto
    // the renewal's own date would produce a series that says a renewal was due
    // on a day nobody could have acted.
    const union = sql.join(
      present.map((register) => sql`
        SELECT tenant_id, ${register.kind} AS kind
          FROM ${sql.raw(register.table)}
         WHERE tenant_id IS NOT NULL
           AND renews_at IS NOT NULL
           AND renews_at <= (CURRENT_DATE + (${RENEWAL_HORIZON_DAYS} * INTERVAL '1 day'))
      `),
      sql` UNION ALL `,
    );

    const due = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension, dimension_key, value, unit, computed_at)
      SELECT r.tenant_id,
             'legal.renewals_due',
             'day',
             DATE_TRUNC('day', NOW()),
             'register',
             r.kind,
             COUNT(*),
             'renewals',
             NOW()
        FROM (${union}) AS r
       GROUP BY r.tenant_id, r.kind
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);

    // The undimensioned total the tile reads, written from the same rows so the
    // headline can never disagree with the breakdown beneath it.
    const total = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT r.tenant_id,
             'legal.renewals_due',
             'day',
             DATE_TRUNC('day', NOW()),
             '',
             COUNT(*),
             'renewals',
             NOW()
        FROM (${union}) AS r
       GROUP BY r.tenant_id
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);

    written['legal.renewals_due'] = rowCount(due) + rowCount(total);
  }

  return {
    written,
    facts: Object.values(written).reduce((sum, n) => sum + n, 0),
    skipped,
  };
}
