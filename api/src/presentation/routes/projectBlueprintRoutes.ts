/**
 * The project's detected `AppBlueprint` (PRD 31 §W2), for the run loop's target choice
 * (§W9 phase 5): the web reads it to decide whether the app runs in the browser or in
 * the container. Read-only — detection stays the one writer (`detectBlueprintForProject`,
 * the `app_blueprint.detect` tool and the push webhook).
 *
 *   GET /:projectId/blueprint → { blueprint: AppBlueprint | null }
 *
 * Mounted at `/api/projects`. A blueprint holds secret NAMES only, never values.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { tenantDoor, type FrontDoor } from '../middleware/frontDoor';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { getLatestBlueprint } from '../../application/blueprint/blueprintDetection';
import { projectInTenantCached } from '../../application/project/projectOwnership';

export function createProjectBlueprintRoutes(db: Db, door: FrontDoor = tenantDoor): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  // Scoped to this path: a catch-all `use('*')` would gate every router sharing the mount.
  router.use('/:projectId/blueprint', door.auth);
  router.get('/:projectId/blueprint', async (c: Context<HonoEnv>) => {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'invalid project id' }, 400);
    const env = c.env as Env;
    if (!(await projectInTenantCached(env, db, c.get('tenantId') as number, projectId))) {
      return c.json({ error: 'project not found' }, 404);
    }
    return c.json({ blueprint: await getLatestBlueprint(env, projectId) });
  });
  return router;
}
