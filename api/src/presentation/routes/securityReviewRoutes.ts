/**
 * Security review routes – /api/security
 *
 * The run-path that consumes a security agent assignment: review supplied
 * code/diff as the agent assigned to security (scope='security').
 *
 *   POST /api/security/review   { code, context? } → { findings, summary, model }
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { SecurityReviewService } from '../../application/security/SecurityReviewService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createSecurityReviewRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // POST /review — not cached: each call reviews caller-supplied code (unbounded,
  // one-shot compute), so there is nothing stable to cache.
  router.post('/review', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ code?: string; context?: string }>();
    if (!body.code?.trim()) return c.json({ error: 'code is required' }, 400);

    const svc = new SecurityReviewService(db, c.env as Env);
    const result = await svc.review(tenantId, { code: body.code, context: body.context });
    return c.json(result);
  });

  return router;
}
