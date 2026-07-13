/**
 * Annual-calendar cadence — periodic LENS snapshots (monthly / quarterly / annual
 * reviews) captured on the same cron sweep pattern as {@link runDueReports}.
 *
 * A snapshot freezes what an insight lens showed for a review PERIOD, independent
 * of later data drift (a "2026-Q3 review" stays exactly as it read at close). We
 * capture the CURRENT (rolling) month / quarter / year snapshot each sweep with an
 * upsert: while a period is in-progress its snapshot is refreshed (bounded by a
 * staleness gate); once the period rolls over it is never written again, so it
 * freezes naturally at close — no separate "finalize" step.
 *
 * The per-lens payload is produced by REUSING the existing application-layer lens
 * compute functions (single source of truth — the snapshot and the live lens never
 * drift). Only tenant-wide lenses are cadence-captured (delivery/portfolio are
 * scope-specific and captured on demand elsewhere).
 *
 * Wired in the composition root (index.ts) on the frequent cron tick alongside
 * runDueReports. Pure period math is unit-testable without a DB.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { lensSnapshots, segments, tenants } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { computeEngineeringInsights } from '../insights/engineeringInsights';
import { computeDora } from '../metrics/workforceMetrics';
import { computeComplianceSummary } from '../insights/complianceInsights';
import { computeFinanceInsights } from '../insights/financeInsights';
import { computeAllocationInsights, type AllocationGoalMap } from '../insights/allocationInsights';
import type { Lens } from '../rbac/personaLens';

/** Lenses that are meaningfully captured at TENANT grain (delivery/portfolio are
 *  scope-specific, so excluded from the tenant-wide cadence). */
export const SNAPSHOTABLE_LENSES = [
  'engineering', 'dora', 'finance', 'allocation', 'compliance',
] as const;
export type SnapshotableLens = (typeof SNAPSHOTABLE_LENSES)[number];

export function isSnapshotableLens(x: unknown): x is SnapshotableLens {
  return typeof x === 'string' && (SNAPSHOTABLE_LENSES as readonly string[]).includes(x);
}

export type SnapshotCadence = 'monthly' | 'quarterly' | 'annual';

// ── period math (pure) ─────────────────────────────────────────────────────────

/** 'YYYY-MM' for a UTC instant. */
export function monthPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** 'YYYY-Qn' for a UTC instant. */
export function quarterPeriod(now: Date): string {
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${now.getUTCFullYear()}-Q${q}`;
}
/** 'YYYY' for a UTC instant. */
export function yearPeriod(now: Date): string {
  return String(now.getUTCFullYear());
}

/** The current in-progress period label for a cadence. */
export function periodFor(cadence: SnapshotCadence, now: Date): string {
  return cadence === 'monthly' ? monthPeriod(now) : cadence === 'quarterly' ? quarterPeriod(now) : yearPeriod(now);
}

/** Classify a period label back to its cadence (for the UI period picker). */
export function cadenceOfPeriod(period: string): SnapshotCadence | null {
  if (/^\d{4}-Q[1-4]$/.test(period)) return 'quarterly';
  if (/^\d{4}-\d{2}$/.test(period)) return 'monthly';
  if (/^\d{4}$/.test(period)) return 'annual';
  return null;
}

/** The three rolling review periods (current month / quarter / year) for `now`. */
export function rollingPeriods(now: Date): Array<{ cadence: SnapshotCadence; period: string }> {
  return [
    { cadence: 'monthly',   period: monthPeriod(now) },
    { cadence: 'quarterly', period: quarterPeriod(now) },
    { cadence: 'annual',    period: yearPeriod(now) },
  ];
}

// ── lens payload capture (reuses the live compute fns — never drifts) ───────────

/** How many days of history a rolling capture reads (a review looks back a quarter). */
const CAPTURE_WINDOW_DAYS = 90;

/** Resolve a tenant's default segment id (finance/allocation are segment-aware). */
async function defaultSegmentId(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.tenantId, tenantId), eq(segments.isDefault, true)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Compute + persist ONE lens snapshot for (tenant, lens, period). Idempotent: the
 * unique (tenant, lens, period) index makes re-capture an in-place refresh (an
 * in-progress period updates; a closed one simply isn't re-swept). Returns the
 * stored row's payload, or null for a non-snapshotable lens.
 */
export async function captureLensSnapshot(
  db: Db,
  tenantId: number,
  lens: Lens | string,
  period: string,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  if (!isSnapshotableLens(lens)) return null;

  let payload: Record<string, unknown>;
  switch (lens) {
    case 'engineering':
      payload = (await computeEngineeringInsights(db, tenantId, CAPTURE_WINDOW_DAYS)) as unknown as Record<string, unknown>;
      break;
    case 'dora':
      payload = (await computeDora(db, tenantId, CAPTURE_WINDOW_DAYS)) as unknown as Record<string, unknown>;
      break;
    case 'compliance':
      payload = (await computeComplianceSummary(db, tenantId, CAPTURE_WINDOW_DAYS)) as unknown as Record<string, unknown>;
      break;
    case 'finance': {
      const segmentId = await defaultSegmentId(db, tenantId);
      // Finance is monthly-keyed; for a quarter/year label fall back to the month of `now`.
      const finPeriod = cadenceOfPeriod(period) === 'monthly' ? period : monthPeriod(now);
      payload = segmentId
        ? (await computeFinanceInsights(db, tenantId, segmentId, finPeriod, now.getTime())) as unknown as Record<string, unknown>
        : { note: 'no default segment' };
      break;
    }
    case 'allocation': {
      const allocPeriod = cadenceOfPeriod(period) === 'monthly' ? period : monthPeriod(now);
      const emptyGoals: AllocationGoalMap = new Map();
      payload = (await computeAllocationInsights(
        db, tenantId, CAPTURE_WINDOW_DAYS, now.getTime(), {}, emptyGoals, { lineage: true },
      )) as unknown as Record<string, unknown>;
      // Keep the period the payload was computed for on the record for clarity.
      payload = { period: allocPeriod, ...payload };
      break;
    }
    default:
      return null;
  }

  await db
    .insert(lensSnapshots)
    .values({ tenantId, lens, period, payload, generatedAt: now })
    .onConflictDoUpdate({
      target: [lensSnapshots.tenantId, lensSnapshots.lens, lensSnapshots.period],
      set: { payload, generatedAt: now },
    });

  return payload;
}

// ── the cron sweep (mirrors runDueReports) ──────────────────────────────────────

/** Bound the per-tick fan-out so a big install can't run away. */
const MAX_TENANTS_PER_TICK = 100;
/** Don't recompute a rolling snapshot more often than this (bounds compute cost;
 *  a closed period is already frozen and never re-swept). */
const REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Capture the current rolling month / quarter / year snapshot for each tenant's
 * snapshotable lenses, skipping any (tenant, lens, period) already refreshed within
 * REFRESH_MS. Bounded, idempotent, and safe to call every cron tick. Returns how
 * many (tenant, lens, period) snapshots were written this tick.
 */
export async function dueSnapshots(env: Env, now: Date = new Date()): Promise<{ captured: number }> {
  const db = buildDatabase(env);
  const periods = rollingPeriods(now).map((p) => p.period);

  const tenantRows = await db.select({ id: tenants.id }).from(tenants).limit(MAX_TENANTS_PER_TICK);
  if (tenantRows.length === 0) return { captured: 0 };
  const tenantIds = tenantRows.map((t) => t.id);

  // One query for freshness: which (tenant, lens, period) were refreshed recently.
  const freshCutoff = new Date(now.getTime() - REFRESH_MS);
  const existing = await db
    .select({ tenantId: lensSnapshots.tenantId, lens: lensSnapshots.lens, period: lensSnapshots.period })
    .from(lensSnapshots)
    .where(and(
      inArray(lensSnapshots.tenantId, tenantIds),
      inArray(lensSnapshots.period, periods),
      sql`${lensSnapshots.generatedAt} > ${freshCutoff}`,
    ));
  const fresh = new Set(existing.map((r) => `${r.tenantId}:${r.lens}:${r.period}`));

  let captured = 0;
  for (const tenantId of tenantIds) {
    for (const period of periods) {
      for (const lens of SNAPSHOTABLE_LENSES) {
        if (fresh.has(`${tenantId}:${lens}:${period}`)) continue;
        try {
          await captureLensSnapshot(db, tenantId, lens, period, now);
          captured += 1;
        } catch (err) {
          console.error('[cron:lens-snapshots] capture failed', tenantId, lens, period, err);
        }
      }
    }
  }
  return { captured };
}
