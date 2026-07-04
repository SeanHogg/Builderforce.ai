import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import { isValidVisitorId, type MarketingService, type MarketingTouch } from '../../application/marketing/MarketingService';
import type { ToolResult } from '../../application/tools/toolTypes';

/**
 * Anonymous marketing-session routes for the free Diagnostics & Tools suite.
 *
 * `POST /track` and `GET /session/:visitorId` are PUBLIC — a logged-out visitor's
 * free run is recorded so they can re-see their diagnostics on return and we can
 * target them with a sign-up. `POST /convert` is authenticated: it stamps the
 * visitor's session converted once they create/link an account (attribution
 * close-out). No tenant data is exposed; the key is the opaque `visitorId`.
 */
export function createMarketingRoutes(marketing: MarketingService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Record one anonymous tool run (fire-and-forget from the client).
  router.post('/track', async (c) => {
    const body = await c.req.json<{
      visitorId?: string;
      toolId?: string;
      input?: Record<string, number>;
      result?: ToolResult;
      touch?: MarketingTouch;
    }>().catch(() => ({}));

    if (!isValidVisitorId(body.visitorId) || typeof body.toolId !== 'string' || !body.toolId || !body.result) {
      return c.json({ error: 'Invalid tracking payload' }, 400);
    }

    await marketing.trackToolRun(c.env as Env, {
      visitorId: body.visitorId,
      toolId: body.toolId.slice(0, 64),
      input: body.input ?? {},
      result: body.result,
      touch: body.touch,
    });
    return c.body(null, 204);
  });

  // A returning visitor's stored diagnostics + session (for the welcome-back view).
  router.get('/session/:visitorId', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    return c.json(await marketing.getSession(c.env as Env, visitorId));
  });

  // Close the funnel: link the anonymous session to the now-authenticated user.
  router.post('/convert', authMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ visitorId?: string }>().catch(() => ({}));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    await marketing.markConverted(c.env as Env, body.visitorId, userId);
    return c.body(null, 204);
  });

  return router;
}
