/**
 * Owner-side housekeeping for a site's collections — the half of the IDE's
 * Database panel that `siteData.ts` (the public write path and its reads) never
 * needed: removing a collection, removing one row, and proving a collection id
 * belongs to the project the route names.
 *
 * Every function is scoped by tenant AND project. The routes take a collection
 * id from the URL; without the project check a manager of one project could
 * reach another project's collection in the same tenant by guessing its id.
 *
 * Uncached by design: these back an owner's admin view, which must show the
 * row they just deleted as gone, and the volume is one person clicking.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteCollections, siteRecords } from '../../infrastructure/database/schema';
import { appsDatabaseOf } from './appsDatabase';

/** Does this collection belong to this project (and tenant)? */
export async function collectionInProject(
  db: Db,
  tenantId: number,
  projectId: number,
  collectionId: number,
): Promise<boolean> {
  const [row] = await appsDatabaseOf(db)
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(
      eq(siteCollections.id, collectionId),
      eq(siteCollections.tenantId, tenantId),
      eq(siteCollections.projectId, projectId),
    ))
    .limit(1);
  return Boolean(row);
}

/** Delete a collection and (by cascade) every record in it. False when it is not this project's. */
export async function deleteCollection(
  db: Db,
  tenantId: number,
  projectId: number,
  collectionId: number,
): Promise<boolean> {
  const deleted = await appsDatabaseOf(db)
    .delete(siteCollections)
    .where(and(
      eq(siteCollections.id, collectionId),
      eq(siteCollections.tenantId, tenantId),
      eq(siteCollections.projectId, projectId),
    ))
    .returning({ id: siteCollections.id });
  return deleted.length > 0;
}

/**
 * Delete one record. The collection's `record_count` is the single writer's
 * denormalised tally (bumped on every public write), so it is decremented here
 * in the same pass — never recounted — to keep that one writer per direction.
 */
export async function deleteRecord(
  db: Db,
  tenantId: number,
  projectId: number,
  collectionId: number,
  recordId: number,
): Promise<boolean> {
  if (!(await collectionInProject(db, tenantId, projectId, collectionId))) return false;
  const apps = appsDatabaseOf(db);
  const deleted = await apps
    .delete(siteRecords)
    .where(and(
      eq(siteRecords.id, recordId),
      eq(siteRecords.collectionId, collectionId),
      eq(siteRecords.tenantId, tenantId),
    ))
    .returning({ id: siteRecords.id });
  if (deleted.length === 0) return false;
  await apps
    .update(siteCollections)
    .set({ recordCount: sql`GREATEST(${siteCollections.recordCount} - 1, 0)`, updatedAt: sql`NOW()` })
    .where(eq(siteCollections.id, collectionId));
  return true;
}
