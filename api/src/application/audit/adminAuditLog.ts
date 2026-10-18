/**
 * The platform-operator audit trail (`admin_audit_log`) — THE read.
 *
 * `infrastructure/audit/adminAudit.ts` is the one writer; this is the one reader.
 * The superadmin list (`GET /api/admin/audit-log`) and its CSV download
 * (`admin.audit-log` export source) used to carry byte-identical copies of this
 * filter-and-order query, and the download's copy hand-quoted its cells — the
 * metadata column's quotes were doubled but no other column's were.
 *
 * DISTINCT FROM `activity_log` (application/activity/activityLog.ts), on purpose:
 * this table is the forensic record of SUPERADMIN actions — cross-tenant by
 * design (a row may name no tenant at all), written on the same path as the
 * action with errors propagating — while `activity_log` is the best-effort,
 * per-tenant workforce timeline. Folding one into the other would either leak
 * operator actions into a customer's timeline or let a failed audit write pass
 * silently. Both are read through ONE use case each.
 *
 * The read is platform-wide: the gate is `superAdminMiddleware` on the route,
 * and `tenantId` is SELECTED (and filterable) rather than forced, because an
 * operator reviewing the trail is looking across every tenant.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { adminAuditLog } from '../../infrastructure/database/schema';
import { positiveIntParam } from '../../domain/shared/boundedInt';

export interface AdminAuditFilter {
  event?: string | null;
  actorId?: string | null;
  targetUserId?: string | null;
  /** Narrow the platform-wide trail to one tenant's rows. */
  tenantId?: number | null;
}

export interface AdminAuditEntry {
  id: string;
  event: string;
  actorId: string | null;
  targetUserId: string | null;
  tenantId: number | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

/**
 * The filter, read from request parameters — ONE reading for the list and the
 * download. The admin client has always sent `actorId` / `targetUserId` /
 * `tenantId` while both routes read `actor` / `target` (and no tenant), so every
 * filter the operator picked was silently ignored; both spellings are accepted.
 */
export function adminAuditFilterFrom(param: (name: string) => string | undefined): AdminAuditFilter {
  return {
    event: param('event'),
    actorId: param('actorId') ?? param('actor'),
    targetUserId: param('targetUserId') ?? param('target'),
    tenantId: positiveIntParam(param('tenantId')),
  };
}

/** The download's ceiling — an operator export, not an unbounded table dump. */
export const ADMIN_AUDIT_EXPORT_CAP = 10_000;

/** Newest-first page of the operator audit trail. */
export async function listAdminAuditLog(
  db: Db,
  filter: AdminAuditFilter,
  page: { limit: number; offset?: number },
): Promise<AdminAuditEntry[]> {
  const conditions = [];
  if (filter.event) conditions.push(eq(adminAuditLog.event, filter.event));
  if (filter.actorId) conditions.push(eq(adminAuditLog.actorId, filter.actorId));
  if (filter.targetUserId) conditions.push(eq(adminAuditLog.targetUserId, filter.targetUserId));
  if (filter.tenantId != null) conditions.push(eq(adminAuditLog.tenantId, filter.tenantId));

  const rows = await db
    .select({
      id: adminAuditLog.id,
      event: adminAuditLog.event,
      actorId: adminAuditLog.actorId,
      targetUserId: adminAuditLog.targetUserId,
      tenantId: adminAuditLog.tenantId,
      ipAddress: adminAuditLog.ipAddress,
      metadata: adminAuditLog.metadata,
      createdAt: adminAuditLog.createdAt,
    })
    .from(adminAuditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(page.limit)
    .offset(page.offset ?? 0);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() ?? null }));
}
