/**
 * Product releases — /api/releases (EMP-10a).
 *
 * A product release is already a first-class entity (product_releases, 0227) and a
 * task already carries release_id (0227). This router exposes the release list +
 * CRUD the release-picker needs; associating a task with a release reuses the
 * existing task update path (PATCH /api/tasks/:id with { releaseId }) so the task
 * route stays the single writer of a task row (see the integration note).
 *
 *   GET    /                list releases (optional ?projectId=) + the  [developer]
 *                           plan-vs-actual schedule rollup
 *   POST   /                create a release                        [manager]
 *   PATCH  /:id             update a release                        [manager]
 *   DELETE /:id             delete a release                        [manager]
 *
 * The rows themselves belong to `ProductReleaseService` — this file decides who
 * may call, parses the request, and picks a status code.
 *
 * `/api/product/release-planning` is a legacy alias of this surface (see
 * {@link createReleasePlanningAliasRoutes}): same service, same rows, kept on the
 * generic-tracker wire shape its embed callers already parse.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { ProductReleaseService, type ReleaseInput } from '../../application/delivery/ProductReleaseService';
import { summarizeReleaseSchedule } from '../../domain/delivery/releaseSchedule';
import { bumpDeliveryInsightsVersion } from '../../application/insights/deliveryInsights';
import type { Env, HonoEnv } from '../../env';
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
 * input`), and an explicit null is how a caller clears one. `releaseDate` is the
 * deprecated alias the service folds onto `targetDate` (see
 * `foldDeprecatedReleaseDate`); it is accepted for one release.
 */
const ReleaseBody = z.looseObject({
  name: releaseText,
  version: releaseText,
  projectId: z.number().nullable().optional(),
  status: releaseText,
  targetDate: z.string().nullable().optional(),
  releasedAt: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  notes: releaseText,
}) satisfies z.ZodType<ReleaseInput>;

/**
 * The alias's wire row: the canonical row plus the `releaseDate` its deployed embed
 * callers still parse, for the deprecation period. Derived — never read from the
 * deprecated `release_date` column (1266 folds it, 1268 drops it): the day it
 * shipped, else the day it is planned for.
 *
 * @deprecated goes with the alias.
 */
export function withDeprecatedReleaseDate<R extends { targetDate: Date | string | null; releasedAt: Date | string | null }>(
  row: R,
): R & { releaseDate: Date | string | null } {
  return { ...row, releaseDate: row.releasedAt ?? row.targetDate };
}

/**
 * A release write changes the delivery lens's plan / actual for that release, so it
 * bumps the lens's per-tenant version token ({@link bumpDeliveryInsightsVersion}) and
 * the next `/api/insights/delivery` read recomputes. Never throws.
 */
async function bumpDeliveryInsights(c: Context<HonoEnv>, operation: string): Promise<void> {
  await bumpDeliveryInsightsVersion(c.env as Env, scope(c).tenantId, operation);
}

/** The canonical path; the alias's successor `Link` names it. */
export const RELEASES_BASE_PATH = '/api/releases';

export function createReleasesRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const service = new ProductReleaseService(db);

  // List releases, optionally scoped to a project (the picker's "releases for this
  // project" mode). Newest planned date first. `schedule` grades the same rows plan
  // vs actual (on-time rate = shipped on or before the target date).
  router.get('/', requireRole(TenantRole.DEVELOPER), async (c) => {
    const projectId = positiveIntParam(c.req.query('projectId'));
    const releases = await service.list(scope(c), projectId);
    return c.json({ releases, schedule: summarizeReleaseSchedule(releases, new Date()) });
  });

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseOptionalBody(c, ReleaseBody);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const row = await service.create(scope(c), { ...body, name });
    await bumpDeliveryInsights(c, 'releases.create');
    return c.json(row, 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseOptionalBody(c, ReleaseBody);
    const row = await service.update(scope(c), c.req.param('id'), body);
    if (!row) return c.json({ error: 'release not found' }, 404);
    await bumpDeliveryInsights(c, 'releases.update');
    return c.json(row);
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const id = c.req.param('id');
    if (await service.remove(scope(c), id)) await bumpDeliveryInsights(c, 'releases.delete');
    return c.json({ deleted: id });
  });

  return router;
}

/**
 * `/api/product/release-planning` — the legacy alias, mounted by productRoutes
 * (which already applies auth). It was a generic-tracker CRUD on the same table;
 * it now calls the SAME service and keeps only the tracker WIRE shape (bare array
 * list, `name is required`, 404 on a missing delete, and the derived `releaseDate`
 * on every row — {@link withDeprecatedReleaseDate}) so deployed embed callers keep
 * parsing it. Every response names `/api/releases` as its successor.
 */
export function createReleasePlanningAliasRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', legacyAliasNotice(RELEASES_BASE_PATH));
  const service = new ProductReleaseService(db);

  router.get('/', async (c) => c.json((await service.list(scope(c))).map(withDeprecatedReleaseDate)));

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseOptionalBody(c, ReleaseBody);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'name is required' }, 400);
    const row = await service.create(scope(c), { ...body, name });
    await bumpDeliveryInsights(c, 'releasePlanning.create');
    return c.json(withDeprecatedReleaseDate(row), 201);
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseOptionalBody(c, ReleaseBody);
    const row = await service.update(scope(c), c.req.param('id'), body);
    if (!row) return c.json({ error: 'not found' }, 404);
    await bumpDeliveryInsights(c, 'releasePlanning.update');
    return c.json(withDeprecatedReleaseDate(row));
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const id = c.req.param('id');
    if (!(await service.remove(scope(c), id))) return c.json({ error: 'not found' }, 404);
    await bumpDeliveryInsights(c, 'releasePlanning.delete');
    return c.json({ deleted: id });
  });

  return router;
}
