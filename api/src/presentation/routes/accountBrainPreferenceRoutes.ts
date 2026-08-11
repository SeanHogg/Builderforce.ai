import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import type { UserId } from '../../domain/shared/types';
import { authMiddleware } from '../middleware/authMiddleware';
import { getAccountBrainPreferences, setAccountBrainPreferences } from '../../application/brain/accountBrainPreferences';

/** Self-service user preferences within the active tenant. The kernel setting is
 * scoped by both the authenticated workspace and the authenticated user. */
export function createAccountBrainPreferenceRoutes(db: Db) {
  const router = new Hono<HonoEnv>();
  router.get('/', authMiddleware, async (c) => {
    const preferences = await getAccountBrainPreferences(db, c.get('tenantId'), c.get('userId') as UserId);
    return c.json({ preferences });
  });
  router.put('/', authMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const preferences = await setAccountBrainPreferences(db, c.get('tenantId'), c.get('userId') as UserId, body);
    return c.json({ preferences });
  });
  return router;
}
