/**
 * Tenant scoping — the structural form of the platform's most important invariant.
 *
 * 261 of the 318 tables carry a `tenant_id`, and "every query against them filters
 * by the caller's tenant" is the rule that keeps one customer's data out of
 * another's. Today that rule is re-typed by hand at ~1,100 call sites as
 * `and(eq(table.tenantId, tenantId), …)`. Every one of those is a chance to forget
 * it, and forgetting it is silent: the query still compiles, still returns rows,
 * and returns SOMEONE ELSE'S rows. (One such omission is already on record — the
 * cross-tenant write on `POST /api/agent-hosts/:id/file-change`.)
 *
 * {@link scopedToTenant} makes the predicate a thing you CALL rather than a thing
 * you remember:
 *
 *   db.select().from(tasks).where(scopedToTenant(tasks, tenantId, eq(tasks.id, id)))
 *
 * Two properties matter:
 *
 *   1. The type parameter only accepts a table that actually HAS a `tenantId`
 *      column, so pointing it at the wrong table is a compile error rather than a
 *      silently-unfiltered query.
 *   2. It is greppable. `npm run check:tenant-scope` parses every Drizzle
 *      statement, and a query against a tenant-owned table with neither this
 *      helper nor an explicit tenant predicate fails the build.
 *
 * For the segmented tier (`segment_id`, the isolation level below the tenant) use
 * {@link scopedToSegment}, which adds the segment predicate on top.
 */

import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from './connection';
import { projects, tasks } from './schema';

/** Any table in the schema that is owned by a tenant. */
export interface TenantOwnedTable {
  tenantId: PgColumn;
}

/** A tenant-owned table that is further partitioned into segments. */
export interface SegmentOwnedTable extends TenantOwnedTable {
  segmentId: PgColumn;
}

/**
 * The tenant predicate for `table`, ANDed with any additional conditions.
 *
 * Pass it straight to `.where()`. `undefined` conditions are dropped, so callers
 * can inline optional filters without building an array first:
 *
 *   .where(scopedToTenant(tasks, tenantId, status ? eq(tasks.status, status) : undefined))
 *
 * The return type is non-optional `SQL` — unlike a bare `and(...)`, which is
 * `SQL | undefined` and therefore assignable to `.where()` even when every
 * condition dropped out. There is always at least the tenant predicate here, so
 * this can never degrade to an unfiltered query.
 */
export function scopedToTenant(
  table: TenantOwnedTable,
  tenantId: number,
  ...conditions: Array<SQL | undefined>
): SQL {
  // `and` returns SQL | undefined only when it receives no defined conditions;
  // the tenant predicate is always present, so the assertion is total.
  return and(eq(table.tenantId, tenantId), ...conditions) as SQL;
}

/**
 * The tenant AND segment predicate for `table`.
 *
 * Use on the segmented tier, where a tenant is subdivided into end-client
 * segments and a tenant-only filter would still leak across them.
 */
export function scopedToSegment(
  table: SegmentOwnedTable,
  tenantId: number,
  segmentId: string,
  ...conditions: Array<SQL | undefined>
): SQL {
  return and(eq(table.tenantId, tenantId), eq(table.segmentId, segmentId), ...conditions) as SQL;
}

// ---------------------------------------------------------------------------
// Derived scope — tables that inherit tenancy through a parent
// ---------------------------------------------------------------------------

/**
 * `tasks` carries no `tenant_id`: a task belongs to a project, and the PROJECT
 * carries the tenant. Every caller that needs "is this task mine?" therefore has
 * to write the same `innerJoin(projects, eq(projects.id, tasks.projectId))` plus
 * `eq(projects.tenantId, tenantId)` — which appears by hand at a dozen sites, and
 * is simply MISSING wherever a task id arrives from an untrusted body.
 *
 * This is that check, once.
 *
 * Returns the task's `projectId` when the task exists and belongs to `tenantId`,
 * and `null` otherwise — so callers can use the project id they almost always
 * need next instead of re-reading it.
 */
export async function taskProjectIfInTenant(
  db: Db,
  taskId: number,
  tenantId: number,
): Promise<number | null> {
  if (!Number.isFinite(taskId)) return null;
  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row?.projectId ?? null;
}

/** Predicate form of {@link taskProjectIfInTenant} for call sites that only gate. */
export async function taskInTenant(db: Db, taskId: number, tenantId: number): Promise<boolean> {
  return (await taskProjectIfInTenant(db, taskId, tenantId)) !== null;
}
