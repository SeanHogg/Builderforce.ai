/**
 * Report subscriptions — which report types a user wants in their inbox.
 * Backs `GET/POST /api/reports/subscriptions`.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { reportSubscriptions } from '../../infrastructure/database/schema';
import { excluded } from '../../infrastructure/database/upsert';
import type { ReportType } from '../../domain/reports/reportTypes';

export function listReportSubscriptions(db: Db, tenantId: number, userId: string) {
  return db.select()
    .from(reportSubscriptions)
    .where(and(eq(reportSubscriptions.tenantId, tenantId), eq(reportSubscriptions.userId, userId)));
}

/** ONE multi-row upsert; each row's own flag comes back through `excluded`. Returns rows written. */
export async function setReportSubscriptions(
  db: Db,
  tenantId: number,
  userId: string,
  items: ReadonlyArray<{ reportType: ReportType; isSubscribed: boolean }>,
): Promise<number> {
  if (items.length === 0) return 0;
  await db.insert(reportSubscriptions)
    .values(items.map((item) => ({ tenantId, userId, reportType: item.reportType, isSubscribed: item.isSubscribed })))
    .onConflictDoUpdate({
      target: [reportSubscriptions.tenantId, reportSubscriptions.userId, reportSubscriptions.reportType],
      set:    { isSubscribed: excluded(reportSubscriptions.isSubscribed), updatedAt: new Date() },
    });
  return items.length;
}
