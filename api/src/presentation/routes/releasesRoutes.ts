/**
 * Product releases — /api/releases (EMP-10a).
 *
 * A product release is already a first-class entity (product_releases, 0227) and a
 * task already carries release_id (0227). This router exposes the release list +
 * CRUD the release-picker needs; associating a task with a release reuses the
 * existing task update path (PATCH /api/tasks/:id with { releaseId }) so the task
 * route stays the single writer of a task row (see the integration note).
 *
 *   GET    /                list releases (optional ?projectId=)   [developer]
 *   POST   /                create a release                        [manager]
 *   PATCH  /:id             update a release                        [manager]
 *   DELETE /:id             delete a release                        [manager]
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { productReleases } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Parse an optional positive-integer query/body value. */
function parseId(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Coerce an ISO date string/number to a Date, or null. */
function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = new Date(raw as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

const RELEASE_STATUSES = ['planned', 'in_progress', 'released', 'cancelled'] as const;

export function createReleasesRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List releases, optionally scoped to a project (the picker's "releases for this
  // project" mode). Newest target/release date first.
  router.get('/', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = parseId(c.req.query('projectId'));
    const where = projectId != null
      ? and(eq(productReleases.tenantId, tenantId), eq(productReleases.projectId, projectId))
      : eq(productReleases.tenantId, tenantId);
    const rows = await db
      .select({
        id: productReleases.id, name: productReleases.name, version: productReleases.version,
        projectId: productReleases.projectId, status: productReleases.status,
        targetDate: productReleases.targetDate, releasedAt: productReleases.releasedAt,
        releaseDate: productReleases.releaseDate, notes: productReleases.notes,
      })
      .from(productReleases)
      .where(where)
      .orderBy(desc(productReleases.targetDate), desc(productReleases.createdAt))
      .limit(500);
    return c.json({ releases: rows });
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    type Body = { name?: string; version?: string; projectId?: number; status?: string; targetDate?: string; releasedAt?: string; notes?: string };
    const body = await c.req.json<Body>().catch(() => ({} as Body));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const status = RELEASE_STATUSES.includes(body.status as never) ? body.status! : 'planned';
    const [row] = await db
      .insert(productReleases)
      .values({
        tenantId, name,
        version: typeof body.version === 'string' ? body.version.trim().slice(0, 50) : null,
        projectId: parseId(body.projectId) ?? null,
        status,
        targetDate: parseDate(body.targetDate),
        releasedAt: parseDate(body.releasedAt),
        notes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null,
      })
      .returning();
    return c.json(row, 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    type Body = { name?: string; version?: string; projectId?: number | null; status?: string; targetDate?: string | null; releasedAt?: string | null; notes?: string };
    const body = await c.req.json<Body>().catch(() => ({} as Body));
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === 'string' && body.name.trim()) set.name = body.name.trim().slice(0, 255);
    if (typeof body.version === 'string') set.version = body.version.trim().slice(0, 50);
    if ('projectId' in body) set.projectId = parseId(body.projectId) ?? null;
    if (RELEASE_STATUSES.includes(body.status as never)) set.status = body.status;
    if ('targetDate' in body) set.targetDate = parseDate(body.targetDate);
    if ('releasedAt' in body) set.releasedAt = parseDate(body.releasedAt);
    if (typeof body.notes === 'string') set.notes = body.notes.slice(0, 4000);

    const [row] = await db
      .update(productReleases)
      .set(set)
      .where(and(eq(productReleases.id, id), eq(productReleases.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'release not found' }, 404);
    return c.json(row);
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    await db.delete(productReleases).where(and(eq(productReleases.id, id), eq(productReleases.tenantId, tenantId)));
    return c.json({ deleted: id });
  });

  return router;
}
