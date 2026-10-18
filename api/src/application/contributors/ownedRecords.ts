/**
 * Load / patch / delete for the tenant-owned records the contributor surfaces CRUD
 * (a contributor, a dev team). `contributorRoutes` and `devTeamRoutes` each carried
 * the same inline "select id where id+tenant → 404 → update/delete" block per verb;
 * this is that block once, on `scopedToTenant`, so a route no longer touches the
 * schema to do it.
 */
import { contributors, devTeams } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import { eq } from 'drizzle-orm';
import { StatusError } from '../../domain/shared/errors';

/** The tenant-owned tables this module serves, with the label its 404 uses. */
const OWNED = {
  contributor: { table: contributors, label: 'Contributor' },
  devTeam: { table: devTeams, label: 'Team' },
} as const;

export type OwnedKind = keyof typeof OWNED;

/** 404 unless the record exists in THIS tenant — the guard every verb starts with. */
export async function requireOwned(db: Db, kind: OwnedKind, tenantId: number, id: number): Promise<void> {
  const { table, label } = OWNED[kind];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(scopedToTenant(table, tenantId, eq(table.id, id)));
  if (!row) throw new StatusError(`${label} not found`, 404);
}

/** Patch an owned record (stamping `updatedAt`) in ONE statement; 404 when it is not this tenant's. */
export async function patchOwned(
  db: Db,
  kind: OwnedKind,
  tenantId: number,
  id: number,
  patch: Record<string, unknown>,
) {
  // The two tables share the (id, tenantId, updatedAt) columns this touches; the
  // union of their insert types is not expressible to drizzle, so narrow once here.
  const table = OWNED[kind].table as typeof contributors;
  const [updated] = await db
    .update(table)
    .set({ ...patch, updatedAt: new Date() })
    .where(scopedToTenant(table, tenantId, eq(table.id, id)))
    .returning();
  if (!updated) throw new StatusError(`${OWNED[kind].label} not found`, 404);
  return updated;
}

/** Delete an owned record in ONE statement; 404 when it is not this tenant's. */
export async function deleteOwned(db: Db, kind: OwnedKind, tenantId: number, id: number): Promise<void> {
  const table = OWNED[kind].table;
  const gone = await db.delete(table).where(scopedToTenant(table, tenantId, eq(table.id, id))).returning({ id: table.id });
  if (gone.length === 0) throw new StatusError(`${OWNED[kind].label} not found`, 404);
}
