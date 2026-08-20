/**
 * projectOwnership — the one ownership gate for a request-supplied project id.
 *
 * A project is the tenancy anchor for everything hung off it: IDE files, sites,
 * datasets, training jobs, agents, QA targets, credentials, journey events. None
 * of those tables can be trusted on their own — they are tenant-owned ONLY via
 * `projects.tenant_id`. So any id that arrives from a request MUST be checked
 * against the caller's tenant, or a caller could read or overwrite another
 * tenant's resources by guessing a number.
 *
 * This existed as a closure inside `ideRoutes.ts`, which meant every other route
 * file that needed the same gate had to either re-implement it or go without.
 * One definition, one behaviour: missing project, non-integer id, or another
 * tenant's project all answer `false`.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects } from '../../infrastructure/database/schema';

/** True when `projectId` names a real project belonging to `tenantId`. */
export async function projectInTenant(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  if (!Number.isInteger(projectId) || projectId < 1) return false;
  const [row] = await db
    .select({ present: sql<number>`1` })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return !!row;
}
