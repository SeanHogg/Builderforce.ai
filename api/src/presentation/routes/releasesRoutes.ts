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
 *
 * The rows themselves belong to `ProductReleaseService` — this file decides who
 * may call, parses the request, and picks a status code.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { ProductReleaseService, type ReleaseInput } from '../../application/delivery/ProductReleaseService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntParam } from './queryParams';
import { parseOptionalBody, z } from './requestBody';

/** The service reads these with `typeof … === 'string'`, so `null` and absent
 *  already meant the same thing; the schema folds them to absent. */
const releaseText = z.string().nullish().transform((value) => value ?? undefined);

/**
 * `ReleaseInput`. Loose because the body is spread into `service.create` and
 * handed to `service.update` whole. `projectId` / `targetDate` / `releasedAt`
 * stay nullable and unfolded: `update` tests their key PRESENCE (`'projectId' in
 * input`), and an explicit null is how a caller clears one.
 */
const ReleaseBody = z.looseObject({
  name: releaseText,
  version: releaseText,
  projectId: z.number().nullable().optional(),
  status: releaseText,
  targetDate: z.string().nullable().optional(),
  releasedAt: z.string().nullable().optional(),
  notes: releaseText,
}) satisfies z.ZodType<ReleaseInput>;

export function createReleasesRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const service = new ProductReleaseService(db);

  // List releases, optionally scoped to a project (the picker's "releases for this
  // project" mode). Newest target/release date first.
  router.get('/', requireRole(TenantRole.DEVELOPER), async (c) => {
    const { tenantId } = scope(c);
    const projectId = positiveIntParam(c.req.query('projectId'));
    return c.json({ releases: await service.list(tenantId, projectId) });
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await parseOptionalBody(c, ReleaseBody);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    return c.json(await service.create(tenantId, { ...body, name }), 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const body = await parseOptionalBody(c, ReleaseBody);
    const row = await service.update(tenantId, c.req.param('id'), body);
    if (!row) return c.json({ error: 'release not found' }, 404);
    return c.json(row);
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const id = c.req.param('id');
    await service.remove(tenantId, id);
    return c.json({ deleted: id });
  });

  return router;
}
