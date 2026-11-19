/**
 * Shared readers for the vertical metric families (PRD 25 Slice D).
 *
 * Every vertical metric resolves the same two ways, in this order:
 *   1. OBSERVED — the latest `metric_facts` point for the key in the window.
 *   2. DECLARED — a hand-entered `custom_kpis` row (`key`), whose `target` carries
 *      the declared value (for `unit: 'stage'` tiles, the 0-based stage ordinal).
 *
 * Neither present → `null` ("Not measured"), never `0`. A rate with no
 * denominator is also `null`.
 *
 * Kept private to Slice D (own file name) so it cannot clash with a shared
 * `declaredKpi.ts` helper another slice may add; swap to that helper once it lands.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { metricFacts } from '../../infrastructure/database/schema/kernel';
import { customKpis } from '../../infrastructure/database/schema/finance';
import { DAY_MS } from '../../domain/shared/time';

/** A finite number from a numeric column / driver string, else null. */
export function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Ratio with a null (not zero) result when the denominator is absent or zero. */
export function ratioOrNull(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

/** Latest observed fact value for a key inside the window, or null. */
export async function latestObservedValue(
  db: Db, tenantId: number, key: string, days: number,
): Promise<number | null> {
  const since = new Date(Date.now() - Math.max(1, days) * DAY_MS);
  const [row] = await db
    .select({ value: metricFacts.value })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, tenantId),
      eq(metricFacts.metric, key),
      gte(metricFacts.bucketAt, since),
    ))
    .orderBy(desc(metricFacts.bucketAt))
    .limit(1);
  return finiteOrNull(row?.value);
}

/** Sum of observed fact values for a key inside the window; null when no points. */
export async function observedSum(
  db: Db, tenantId: number, key: string, days: number,
): Promise<number | null> {
  const since = new Date(Date.now() - Math.max(1, days) * DAY_MS);
  const [row] = await db
    .select({ total: sql<string | null>`sum(${metricFacts.value})`, n: sql<number>`count(*)` })
    .from(metricFacts)
    .where(and(
      eq(metricFacts.tenantId, tenantId),
      eq(metricFacts.metric, key),
      gte(metricFacts.bucketAt, since),
    ));
  if (!row || Number(row.n) === 0) return null;
  return finiteOrNull(row.total);
}

/** The hand-entered value of a `custom_kpis` row (stored in `target`), or null. */
export async function declaredValue(db: Db, tenantId: number, key: string): Promise<number | null> {
  const [row] = await db
    .select({ target: customKpis.target })
    .from(customKpis)
    .where(and(eq(customKpis.tenantId, tenantId), eq(customKpis.key, key)))
    .limit(1);
  return finiteOrNull(row?.target);
}

/** Observed latest value, falling back to the declared custom KPI. */
export async function observedOrDeclared(
  db: Db, tenantId: number, key: string, days: number,
): Promise<number | null> {
  return (await latestObservedValue(db, tenantId, key, days)) ?? (await declaredValue(db, tenantId, key));
}

/**
 * A milestone (stage) metric: the value is a 0-based ordinal into `stages`.
 * Out-of-range or non-integer values are treated as not measured.
 */
export async function stageValue(
  db: Db, tenantId: number, key: string, stages: readonly string[],
): Promise<number | null> {
  // Stages are state, not a windowed rate: look back far enough that a stage
  // recorded last year is still the current stage.
  const v = await observedOrDeclared(db, tenantId, key, 3650);
  if (v == null || !Number.isInteger(v) || v < 0 || v >= stages.length) return null;
  return v;
}

/** Stage label for an ordinal, or null. Pure — used by tests and the widget contract. */
export function stageLabel(stages: readonly string[], ordinal: number | null): string | null {
  if (ordinal == null) return null;
  return stages[ordinal] ?? null;
}
