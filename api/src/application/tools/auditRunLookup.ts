import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, systemAuditRuns } from '../../infrastructure/database/schema';
import { loadProjectInTenant } from '../project/projectOwnership';

/**
 * The one in-flight run of `auditId` on a project, for a findings report that did not
 * name its run. `null` when there is none or more than one — the caller must then ask
 * for `runId` rather than guess which run the findings belong to.
 */
export async function findSoleActiveAuditRunId(
  db: Db, args: { tenantId: number; projectId: number; auditId: string },
): Promise<string | null> {
  await loadProjectInTenant(db, args.tenantId, args.projectId, { id: projects.id });
  const active = await db.select({ id: systemAuditRuns.id }).from(systemAuditRuns).where(and(
    eq(systemAuditRuns.tenantId, args.tenantId), eq(systemAuditRuns.projectId, args.projectId), eq(systemAuditRuns.auditId, args.auditId),
    inArray(systemAuditRuns.status, ['running', 'queued', 'remediation_pending']),
  )).orderBy(desc(systemAuditRuns.createdAt)).limit(2);
  return active.length === 1 ? active[0]!.id : null;
}
