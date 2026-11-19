/**
 * DECLARED KPI READER (PRD 25 §25a.3 B1) — the hand-entered half of a metric.
 *
 * Where no connected source produces a value, the founder declares it. A declared
 * KPI is a `custom_kpis` row whose `target` carries the declared value (the same
 * convention `declaredStageKpi.ts` uses for ordinal stages). One reader, reused by
 * every metric family, so "declared" means the same thing everywhere.
 *
 * Returns `null` — never `0` — when the key was never declared: a missing value is
 * "Not measured", and zero would be a claim.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { customKpis } from '../../infrastructure/database/schema/finance';

/** The latest declared value for `key`, or `null` when none was declared. */
export async function latestDeclaredValue(db: Db, tenantId: number, key: string): Promise<number | null> {
  const [row] = await db
    .select({ target: customKpis.target })
    .from(customKpis)
    .where(and(eq(customKpis.tenantId, tenantId), eq(customKpis.key, key)))
    .limit(1);
  if (!row || row.target == null) return null;
  const value = Number(row.target);
  return Number.isFinite(value) ? value : null;
}
