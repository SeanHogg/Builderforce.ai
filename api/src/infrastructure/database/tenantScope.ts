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
 * The reasons a read against a tenant-owned table may legitimately cross tenants.
 *
 * A CLOSED set, because "this one is special" is exactly the sentence that
 * precedes a leak. Each value names a mechanism that supplies access control of
 * its own, which is the only thing that makes the absent tenant predicate safe:
 *
 *   `public_catalogue` — the row is published FOR strangers. `catalog_items` is
 *     the case: its `tenant_id` is nullable precisely because a public listing is
 *     platform-facing, and filtering the marketplace by the shopper's own tenant
 *     would mean nobody could buy anything they had not already published.
 *     The access predicate is `visibility = 'public'`.
 *   `share_token` — the TOKEN is the credential and carries no session, so the row
 *     it resolves to reports the tenant rather than the caller asserting one.
 *   `platform_admin` — a superadmin surface that is cross-tenant by definition and
 *     is gated before the query is reached.
 */
export type CrossTenantReason = 'public_catalogue' | 'share_token' | 'platform_admin';

/**
 * A DECLARED cross-tenant read.
 *
 * The tenant-scope guard exists to catch the query that FORGOT its tenant. A
 * handful of reads have no tenant to filter by, and until now the only way to say
 * so was to add a line to the frozen-debt baseline — which files a deliberate
 * decision in the same drawer as an accident, and makes the debt number go up when
 * nothing was owed.
 *
 * This is the other answer: state the reason, in the statement, in a form the guard
 * and a reviewer both read. It is greppable (`acrossTenants(` finds every one), it
 * is typed against tables that actually have a `tenantId` so it cannot be pointed
 * at the wrong one, and — the property that matters — it REFUSES to build a
 * predicate out of nothing. A cross-tenant read still has to say what governs it;
 * dropping the tenant filter is allowed, dropping all access control is not.
 */
export function acrossTenants(
  _table: TenantOwnedTable,
  _reason: CrossTenantReason,
  ...conditions: Array<SQL | undefined>
): SQL {
  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (present.length === 0) {
    // Unlike `scopedToTenant`, there is no always-present predicate to fall back
    // on here, so an empty call would silently return the whole table across every
    // tenant on the deployment. That is the one outcome this helper exists to make
    // impossible, and a thrown error at the call site beats it reaching a customer.
    throw new Error('acrossTenants: a cross-tenant read must still carry an access predicate');
  }
  return and(...present) as SQL;
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
