import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import type { UserId } from '../../domain/shared/types';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { getAccountBrainPreferences, setAccountBrainPreferences } from '../../application/brain/accountBrainPreferences';

/** Self-service account preferences: an authenticated user always has full read/write
 * authority over their own row, independent of workspace role or tenant permissions. */
export function createAccountBrainPreferenceRoutes(db: Db) {
  const router = new Hono<HonoEnv>();
  router.get('/', webAuthMiddleware, async (c) => {
    const preferences = await getAccountBrainPreferences(db, c.get('userId') as UserId);
    return c.json({ preferences });
  });
  router.put('/', webAuthMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const preferences = await setAccountBrainPreferences(db, c.get('userId') as UserId, body);
    return c.json({ preferences });
  });
  return router;
}
