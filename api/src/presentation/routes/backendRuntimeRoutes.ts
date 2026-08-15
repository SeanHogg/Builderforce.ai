/**
 * `/api/backend-runtime` — the callback surface a SELF-HOSTED backend uses.
 *
 *   GET /projects/:projectId/collections/:name   read a site collection
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A handler's `data` step reads back what the project's own site collected — the
 * counterpart to the public write endpoint, and the thing that lets a page be
 * built out of what a form gathered. On the Builderforce-hosted ingress that
 * read happens in-process.
 *
 * A backend deployed into the customer's own cloud has no such access, so before
 * this route existed the generated code SILENTLY DROPPED every `data` step: a
 * handler that worked perfectly on the platform returned an empty list the day it
 * was moved to AWS, with nothing anywhere saying why. That is the worst class of
 * migration bug — the system does not fail, it quietly stops being right.
 *
 * ── WHY IT IS NOT ON `/api/projects/:id` ────────────────────────────────────
 * That router authenticates a user JWT. The caller here is a deployed backend
 * holding a tenant API key (`bfk_*`), which is the same credential its model
 * calls already use — so it authenticates through {@link requireTenantAccess},
 * exactly as the gateway and the semantic cache do.
 *
 * ── WHY THE PROJECT IS RE-SCOPED ────────────────────────────────────────────
 * The project id comes off the URL, and a key is scoped to a TENANT rather than
 * to a project. Without the ownership check any customer's deployed backend could
 * read any other project's signup list in their own workspace by changing one
 * number in a URL.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { findProjectForTenant } from '../../application/backend';
import { listSiteRecordsForHandler } from '../../application/ide/siteData';
import { requireTenantAccess, respondToAccessError } from './llmRoutes';

/** Same ceiling the in-process runtime applies — a handler runs inside a
 *  webhook's latency budget wherever it happens to be deployed. */
const MAX_LIMIT = 100;

export function createBackendRuntimeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/projects/:projectId/collections/:name', async (c) => {
    let access;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const project = await findProjectForTenant(db, access.tenantId, Number(c.req.param('projectId')));
    // 404 rather than 403: the existence of another tenant's project is itself
    // information, and a deployed backend has no business learning it.
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const rawLimit = Number(c.req.query('limit'));
    const matchField = c.req.query('matchField');
    const matchValue = c.req.query('matchValue');

    const read = await listSiteRecordsForHandler({
      db,
      tenantId: access.tenantId,
      projectId: project.id,
      collectionName: c.req.param('name'),
      limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : undefined,
      // Both halves or neither — one alone silently returns everything, which is
      // the same mistake the handler parser rejects at authoring time.
      match: matchField && matchValue !== undefined ? { field: matchField, value: matchValue } : undefined,
    });

    return c.json(read);
  });

  return router;
}
