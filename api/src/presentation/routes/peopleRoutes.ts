/**
 * People routes - GET /api/people/:userId
 *
 * One teammate's profile: name, avatar, role, personality and a work summary.
 * Any member of the workspace may read another member's; a user outside it is a 404.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireTenantId } from '../middleware/tenantContext';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { readPersonProfile } from '../../application/people/personProfile';

export function createPeopleRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:userId', async (c) => {
    const profile = await readPersonProfile(db, requireTenantId(c), c.req.param('userId'));
    if (!profile) return c.json({ error: 'Person not found' }, 404);
    return c.json(profile);
  });

  return router;
}
