import { reportCaughtError } from '../observability/caughtErrorReporter';
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
 * Registered as the `lens-snapshots` entry in `src/cronSweeps.ts` on the frequent
 * cron tick, beside `reports`. Pure period math is unit-testable without a DB.
 */

import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { lensSnapshots, segments, tenants } from '../../infrastructure/database/schema';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { computeEngineeringInsights } from '../insights/engineeringInsights';
import { computeDora } from '../metrics/workforceMetrics';
import { computeComplianceSummary } from '../insights/complianceInsights';
import { computeFinanceInsights } from '../insights/financeInsights';
import { computeAllocationInsights, type AllocationGoalMap } from '../insights/allocationInsights';
import type { Lens } from '../rbac/personaLens';
import { HOUR_MS } from '../../domain/shared/time';

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
/** Cadences a snapshot period can belong to — the vocabulary the console offers. */
export const SNAPSHOT_CADENCES: readonly SnapshotCadence[] = ['monthly', 'quarterly', 'annual'];

/**
 * Captured-snapshot metadata for the console list — deliberately WITHOUT the
 * frozen payloads, which are large and only read one at a time. Tenant-scoped in
 * the query rather than by the caller, and capped at 500 rows.
 */
export async function listLensSnapshots(
  db: Db,
  tenantId: number,
  filters: { lens?: string; period?: string } = {},
) {
  const conds = [eq(lensSnapshots.tenantId, tenantId)];
  if (filters.lens && isSnapshotableLens(filters.lens)) conds.push(eq(lensSnapshots.lens, filters.lens));
  if (filters.period) conds.push(eq(lensSnapshots.period, filters.period));

  const rows = await db
    .select({
      id: lensSnapshots.id,
      lens: lensSnapshots.lens,
      period: lensSnapshots.period,
      generatedAt: lensSnapshots.generatedAt,
    })
    .from(lensSnapshots)
    .where(and(...conds))
    .orderBy(desc(lensSnapshots.generatedAt))
    .limit(500);

  return rows.map((r) => ({ ...r, cadence: cadenceOfPeriod(r.period) }));
}

/** One snapshot's frozen payload, scoped to the tenant that owns it. */
export async function getLensSnapshot(db: Db, tenantId: number, id: string) {
  const [row] = await db
    .select()
    .from(lensSnapshots)
    .where(and(eq(lensSnapshots.id, id), eq(lensSnapshots.tenantId, tenantId)))
    .limit(1);
  return row ? { ...row, cadence: cadenceOfPeriod(row.period) } : null;
}

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
const REFRESH_MS = 6 * HOUR_MS;

/**
 * KV key: `{ [tenantId]: retryNotBeforeMs }` for tenants whose capture THREW.
 *
 * A failed capture writes no row, so to the freshness check it looks exactly like a
 * tenant never captured — and was retried (and logged as an error) on every active
 * tick, every five minutes, for as long as the failure lasted. A failure is therefore
 * treated as fresh for one {@link REFRESH_MS}: the tenant is left out of the next
 * selections until then, and retried at the cadence a success would be refreshed at.
 *
 * KV rather than a column: the only row a failure could mark is the snapshot itself,
 * and stamping `generated_at` on a payload that was never recomputed would make the
 * console present a stale snapshot as a fresh one. One small blob, read once and
 * written at most once per tick.
 */
export const LENS_SNAPSHOT_BACKOFF_KEY = 'lens-snapshots:backoff:v1';
const BACKOFF_KV_TTL_SECONDS = Math.ceil(REFRESH_MS / 1000);

type BackoffMap = Record<string, number>;

/** The backoff entries still in force at `nowMs` — expired ones are dropped. */
export function activeBackoff(raw: BackoffMap | null, nowMs: number): BackoffMap {
  const active: BackoffMap = {};
  for (const [tenantId, until] of Object.entries(raw ?? {})) {
    if (Number.isFinite(until) && until > nowMs) active[tenantId] = until;
  }
  return active;
}

/**
 * Tenants owed at least one rolling snapshot, most-owed first.
 *
 * The read used to be `SELECT id FROM tenants LIMIT 100` — no ORDER BY, no filter —
 * so it returned the same ~100 rows in heap order every tick, and every tenant past
 * that position was never snapshotted at all. It now selects only tenants that still
 * owe a (lens, period) snapshot fresher than REFRESH_MS, ordered by how few fresh ones
 * they hold (never-captured first) and then by id. A tenant that is captured stops
 * qualifying, so the window moves on and every tenant is reached within
 * ceil(owing tenants / MAX_TENANTS_PER_TICK) active ticks. Backed-off tenants are
 * excluded so a persistently failing tenant cannot occupy a slot either.
 *
 * Split out and synchronous so the rendered SQL can be asserted without a connection.
 */
export function owingTenantsQuery(
  db: Db,
  periods: readonly string[],
  freshCutoff: Date,
  excludeTenantIds: readonly number[],
  limit: number = MAX_TENANTS_PER_TICK,
) {
  const expected = periods.length * SNAPSHOTABLE_LENSES.length;
  // Served by the (tenant_id, lens, period) unique index.
  const freshCount = sql<number>`(
    SELECT COUNT(*) FROM ${lensSnapshots}
    WHERE ${lensSnapshots.tenantId} = ${tenants.id}
      AND ${inArray(lensSnapshots.period, [...periods])}
      AND ${lensSnapshots.generatedAt} > ${freshCutoff}
  )`;
  return db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(
      sql`${freshCount} < ${expected}`,
      excludeTenantIds.length ? notInArray(tenants.id, [...excludeTenantIds]) : undefined,
    ))
    .orderBy(asc(freshCount), asc(tenants.id))
    .limit(limit);
}

/**
 * Capture the current rolling month / quarter / year snapshot for each tenant's
 * snapshotable lenses, skipping any (tenant, lens, period) already refreshed within
 * REFRESH_MS. Bounded, idempotent, and safe to call every cron tick. Returns how
 * many (tenant, lens, period) snapshots were written this tick, and how many tenants
 * had a capture fail (each is backed off for REFRESH_MS).
 */
export async function dueSnapshots(
  env: Env,
  now: Date = new Date(),
  db: Db = buildDatabase(env),
): Promise<{ captured: number; failedTenants: number }> {
  const periods = rollingPeriods(now).map((p) => p.period);
  const nowMs = now.getTime();
  const freshCutoff = new Date(nowMs - REFRESH_MS);

  const storedBackoff = await peekCached<BackoffMap>(env, LENS_SNAPSHOT_BACKOFF_KEY);
  const backoff = activeBackoff(storedBackoff, nowMs);
  let backoffChanged = Object.keys(backoff).length !== Object.keys(storedBackoff ?? {}).length;

  const tenantRows = await owingTenantsQuery(db, periods, freshCutoff, Object.keys(backoff).map(Number));
  let captured = 0;
  let failedTenants = 0;

  if (tenantRows.length > 0) {
    const tenantIds = tenantRows.map((t) => t.id);

    // One query for freshness: which (tenant, lens, period) were refreshed recently.
    const existing = await db
      .select({ tenantId: lensSnapshots.tenantId, lens: lensSnapshots.lens, period: lensSnapshots.period })
      .from(lensSnapshots)
      .where(and(
        inArray(lensSnapshots.tenantId, tenantIds),
        inArray(lensSnapshots.period, periods),
        sql`${lensSnapshots.generatedAt} > ${freshCutoff}`,
      ));
    const fresh = new Set(existing.map((r) => `${r.tenantId}:${r.lens}:${r.period}`));

    for (const tenantId of tenantIds) {
      let failed = false;
      for (const period of periods) {
        for (const lens of SNAPSHOTABLE_LENSES) {
          if (fresh.has(`${tenantId}:${lens}:${period}`)) continue;
          try {
            await captureLensSnapshot(db, tenantId, lens, period, now);
            captured += 1;
          } catch (err) {
            failed = true;
            reportCaughtError(err, { source: "application/reports/lensSnapshots.ts", operation: "dueSnapshots", context: { logMessage: '[cron:lens-snapshots] capture failed; tenant backed off for one refresh interval', details: { tenantId, lens, period } } });
          }
        }
      }
      // The lenses that DID capture are fresh on their own; the backoff only stops the
      // failed ones being retried — and re-logged — on every tick until REFRESH_MS.
      if (failed) {
        failedTenants += 1;
        backoff[String(tenantId)] = nowMs + REFRESH_MS;
        backoffChanged = true;
      }
    }
  }

  if (backoffChanged) {
    await setCached(env, LENS_SNAPSHOT_BACKOFF_KEY, backoff, { kvTtlSeconds: BACKOFF_KV_TTL_SECONDS });
  }
  return { captured, failedTenants };
}
