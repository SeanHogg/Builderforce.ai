/**
 * Job seeker: job alerts.
 *
 * An alert is a SAVED SEARCH with `scope='listing'`, not a new table: it is the same
 * {name, filters, owner, last run} shape `saved_searches` already holds for contacts,
 * companies, deals and candidates, and that table's `scope` column exists precisely
 * so the fifth one does not add DDL. (The sweep that matches alerts against new
 * postings is `../jobAlerts.ts`.)
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { savedSearches, users } from '../../../infrastructure/database/schema';
import { excluded } from '../../../infrastructure/database/upsert';
import { resolvePersonalTenantId } from '../../resume/profileResume';
import { ensurePersonalWorkspace } from '../../tenant/starterWorkspace';

/** The body an alert write accepts. `enabled` rides inside `filters` (see `mapAlert`). */
export interface JobAlertInput {
  name?: string;
  filters?: Record<string, unknown>;
  enabled?: boolean;
}

/** A job alert on the wire. `enabled` lives inside `filters` so turning one off does
 *  not need a column the other four saved-search scopes would carry unused. */
function mapAlert(row: { id: number; name: string; filters: unknown; last_run_at: Date | null; result_count: number | null }) {
  const filters = (row.filters ?? {}) as Record<string, unknown>;
  const { enabled, ...criteria } = filters;
  return {
    id: String(row.id),
    name: row.name,
    filters: criteria,
    enabled: enabled !== false,
    lastRunAt: row.last_run_at ?? null,
    resultCount: row.result_count ?? null,
  };
}

/**
 * The workspace a job seeker's own records live in, provisioning it if missing.
 *
 * A saved search is tenant-scoped and a for-hire account is not a member of any
 * employer's workspace, so their alerts belong to the personal workspace 0471 gives
 * them. Self-heals accounts created before that existed.
 */
async function seekerTenantId(db: Db, env: Env, userId: string): Promise<number | null> {
  const existing = await resolvePersonalTenantId(db, userId);
  if (existing !== null) return existing;
  const [user] = await db.select({ email: users.email, displayName: users.displayName })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  await ensurePersonalWorkspace(env, db, {
    id: userId, email: user.email, displayName: user.displayName, accountType: 'freelancer',
  });
  return resolvePersonalTenantId(db, userId);
}

/** The seeker's alerts; empty when they have no workspace to hold any. */
export async function listJobAlerts(db: Db, env: Env, userId: string) {
  const tenantId = await seekerTenantId(db, env, userId);
  if (tenantId === null) return [];
  const rows = await db.select({
    id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
    last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount,
  }).from(savedSearches)
    .where(and(
      eq(savedSearches.tenantId, tenantId),
      eq(savedSearches.ownerRef, userId),
      eq(savedSearches.scope, 'listing'),
    ))
    .orderBy(desc(savedSearches.createdAt))
    .limit(50);
  return rows.map(mapAlert);
}

/** Create (or re-filter, by name) an alert. Null when the seeker has no workspace. */
export async function createJobAlert(db: Db, env: Env, userId: string, name: string, body: JobAlertInput) {
  const tenantId = await seekerTenantId(db, env, userId);
  if (tenantId === null) return null;
  const [row] = await db.insert(savedSearches)
    .values({
      tenantId, ownerRef: userId, scope: 'listing', name,
      filters: { ...(body.filters ?? {}), enabled: body.enabled !== false },
    })
    .onConflictDoUpdate({
      target: [savedSearches.tenantId, savedSearches.ownerRef, savedSearches.scope, savedSearches.name],
      set: { filters: excluded(savedSearches.filters), updatedAt: sql`NOW()` },
    })
    .returning({ id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
      last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount });
  return mapAlert(row!);
}

/**
 * Rename, re-filter, or turn it on and off. One write rather than a separate toggle,
 * because "enabled" is a field like any other. Null when there is no such alert.
 */
export async function updateJobAlert(db: Db, env: Env, userId: string, alertId: number, body: JobAlertInput) {
  const tenantId = await seekerTenantId(db, env, userId);
  if (tenantId === null) return null;
  const [existing] = await db.select({ filters: savedSearches.filters })
    .from(savedSearches)
    .where(and(
      eq(savedSearches.id, alertId),
      eq(savedSearches.tenantId, tenantId),
      eq(savedSearches.ownerRef, userId),
      eq(savedSearches.scope, 'listing'),
    ));
  if (!existing) return null;
  const current = (existing.filters ?? {}) as Record<string, unknown>;
  const filters = {
    ...current,
    ...(body.filters ?? {}),
    ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
  };
  const [row] = await db.update(savedSearches)
    .set({ ...(body.name ? { name: body.name.slice(0, 200) } : {}), filters, updatedAt: sql`NOW()` })
    .where(and(
      eq(savedSearches.id, alertId),
      eq(savedSearches.tenantId, tenantId),
      eq(savedSearches.ownerRef, userId),
    ))
    .returning({ id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
      last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount });
  return row ? mapAlert(row) : null;
}

/** Delete one of the seeker's alerts. A seeker with no workspace has nothing to delete. */
export async function deleteJobAlert(db: Db, env: Env, userId: string, alertId: number): Promise<void> {
  const tenantId = await seekerTenantId(db, env, userId);
  if (tenantId === null) return;
  await db.delete(savedSearches).where(and(
    eq(savedSearches.id, alertId),
    eq(savedSearches.tenantId, tenantId),
    eq(savedSearches.ownerRef, userId),
    eq(savedSearches.scope, 'listing'),
  ));
}
