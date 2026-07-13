/**
 * Single source of truth for sensitive-action audit trails.
 *
 * Any superadmin/elevated action that mutates billing/permissions OR reads
 * sensitive captured data (LLM trace bodies, stored credentials) writes one
 * `admin_audit_log` row through here, so the forensic trail has a consistent
 * shape and one insert path. Previously the only writer was a closure local to
 * adminRoutes; other routes (e.g. QA credential-secret reads) had no trail.
 */
import { adminAuditLog } from '../database/schema';
import type { Db } from '../database/connection';

export interface AdminAuditOpts {
  targetUserId?: string | null;
  tenantId?: number | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Insert one `admin_audit_log` row. Errors propagate to the caller — audit a
 *  sensitive action on the same path that performs it. */
export async function writeAdminAudit(
  db: Db,
  event: string,
  actorId: string | null,
  opts: AdminAuditOpts = {},
): Promise<void> {
  await db.insert(adminAuditLog).values({
    event,
    actorId:      actorId ?? null,
    targetUserId: opts.targetUserId ?? null,
    tenantId:     opts.tenantId ?? null,
    metadata:     JSON.stringify(opts.metadata ?? {}),
    ipAddress:    opts.ipAddress ?? null,
  });
}
