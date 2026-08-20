/**
 * Per-user widget pins — a member's personal favourites on their own /insights
 * home dashboard, scoped to (tenant, user).
 *
 * There is no manager gate anywhere in here on purpose: pinning touches only the
 * caller's own rows, and every function below takes the userId as an argument
 * rather than reading it from a request, which is what makes that true by
 * construction instead of by convention.
 *
 * The list read is cached and every write invalidates it, so a member's home
 * loads without a round-trip per visit. The key and the invalidation live beside
 * each other here; they were split across four route handlers until 2026-08-19,
 * and a fifth handler that forgot to invalidate would have served a stale home
 * with nothing to catch it.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { dashboardPins } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const PINS_TTL = { kvTtlSeconds: 120, l1TtlMs: 30_000 };

const pinsKey = (tenantId: number, userId: string) => `dashboard-pins:t:${tenantId}:u:${userId}`;

/** A widget id is an opaque registry key (validated client-side); bound length. */
export function cleanWidgetKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= 1 && s.length <= 96 ? s : null;
}

export interface Pin { widgetKey: string; position: number }

function loadPins(db: Db, tenantId: number, userId: string): Promise<Pin[]> {
  return db
    .select({ widgetKey: dashboardPins.widgetKey, position: dashboardPins.position })
    .from(dashboardPins)
    .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, userId)))
    .orderBy(asc(dashboardPins.position), asc(dashboardPins.id));
}

/** The caller's pins, in order. Cached. */
export function listPins(db: Db, env: Env, tenantId: number, userId: string): Promise<Pin[]> {
  return getOrSetCached(env, pinsKey(tenantId, userId), () => loadPins(db, tenantId, userId), PINS_TTL);
}

/** Append a pin at the end. Idempotent — re-pinning an existing widget is a no-op
 *  that still reports the row, so the client does not have to distinguish. */
export async function addPin(db: Db, env: Env, tenantId: number, userId: string, widgetKey: string): Promise<Pin> {
  const maxRows = await db
    .select({ max: sql<number>`coalesce(max(${dashboardPins.position}), -1)` })
    .from(dashboardPins)
    .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, userId)));
  const position = Number(maxRows[0]?.max ?? -1) + 1;

  const [row] = await db
    .insert(dashboardPins)
    .values({ tenantId, userId, widgetKey, position })
    .onConflictDoNothing()
    .returning({ widgetKey: dashboardPins.widgetKey, position: dashboardPins.position });

  await invalidateCached(env, pinsKey(tenantId, userId));
  return row ?? { widgetKey, position };
}

export async function removePin(db: Db, env: Env, tenantId: number, userId: string, widgetKey: string): Promise<void> {
  await db
    .delete(dashboardPins)
    .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, userId), eq(dashboardPins.widgetKey, widgetKey)));
  await invalidateCached(env, pinsKey(tenantId, userId));
}

/** Apply positions in the given order. Sequential is fine: the set is small and
 *  neon-http has no interactive transaction to batch it into anyway. */
export async function reorderPins(db: Db, env: Env, tenantId: number, userId: string, order: string[]): Promise<Pin[]> {
  let i = 0;
  for (const key of order) {
    await db
      .update(dashboardPins)
      .set({ position: i })
      .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, userId), eq(dashboardPins.widgetKey, key)));
    i++;
  }
  await invalidateCached(env, pinsKey(tenantId, userId));
  return loadPins(db, tenantId, userId);
}
