/**
 * Media credit accounting — how many units (images, video seconds) a tenant has
 * generated today. ONE query for every media kind; each kind supplies only its
 * product labels and the tokens it logs per unit (`mediaProducts.ts`).
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import { utcDayStart } from './tokenUsage';

export interface MediaCreditKind {
  /** `llm_product` labels this kind is logged under. */
  products: readonly string[];
  /** `total_tokens` logged per unit — the divisor that recovers units. */
  unitTokens: number;
}

/** Units of `kind` the tenant has generated since the start of the UTC day. */
export async function mediaUnitsUsedToday(db: Db, tenantId: number, kind: MediaCreditKind): Promise<number> {
  const [row] = await db
    .select({ tokens: sql<number>`COALESCE(SUM(${llmUsageLog.totalTokens}), 0)` })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantId, tenantId),
      inArray(llmUsageLog.llmProduct, [...kind.products]),
      gte(llmUsageLog.createdAt, utcDayStart()),
    ));
  return Math.floor(Number(row?.tokens ?? 0) / kind.unitTokens);
}

/** Would generating `requested` more units exceed `limit`? `-1` = unlimited. */
export function mediaCreditExceeded(limit: number, used: number, requested: number): boolean {
  return limit >= 0 && used + Math.max(1, requested) > limit;
}

/** {@link mediaUnitsUsedToday} against the usage ledger's own database — what the
 *  request-path credit gate calls, so presentation never builds a connection. */
export function mediaUnitsUsedTodayIn(env: Parameters<typeof buildTransactionalDatabase>[0], tenantId: number, kind: MediaCreditKind): Promise<number> {
  return mediaUnitsUsedToday(buildTransactionalDatabase(env), tenantId, kind);
}
