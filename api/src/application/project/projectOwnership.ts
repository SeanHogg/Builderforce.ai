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

import { and, eq } from 'drizzle-orm';
import type { PgColumn, SelectedFields } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import { projects } from '../../infrastructure/database/schema';

/** The row shape a `columns` selection produces: nullable columns read as `T | null`. */
type Selected<T extends Record<string, PgColumn>> = {
  [K in keyof T]: T[K]['_']['notNull'] extends true ? T[K]['_']['data'] : T[K]['_']['data'] | null;
};

/**
 * The project's row, tenant-scoped — `null` when the id is not an integer, the
 * project does not exist, or it belongs to another tenant. Callers that need a
 * few columns of a project they were HANDED an id for read them through this,
 * so the ownership predicate and the column read are one query and one rule.
 *
 * Twenty-two application modules used to write this select out by hand beside
 * `projectInTenant`; a hand-written copy is one edit away from a cross-tenant
 * read, which is why the review that migrated them made the column read part
 * of the gate rather than a second query after it.
 */
export async function loadProjectInTenant<T extends Record<string, PgColumn>>(
  db: Db,
  tenantId: number,
  projectId: number,
  columns: T,
): Promise<Selected<T> | null> {
  if (!Number.isInteger(projectId) || projectId < 1) return null;
  // The selection is generic over the caller's columns, which drizzle's
  // overloads cannot resolve statically; the row type is re-asserted from `T`.
  const rows: Record<string, unknown>[] = await db
    .select(columns as SelectedFields)
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return (rows[0] as Selected<T> | undefined) ?? null;
}

/** True when `projectId` names a real project belonging to `tenantId`. */
export async function projectInTenant(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  return (await loadProjectInTenant(db, tenantId, projectId, { id: projects.id })) != null;
}
