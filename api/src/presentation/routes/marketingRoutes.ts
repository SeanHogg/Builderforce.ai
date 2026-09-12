import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import { isValidVisitorId, type MarketingService } from '../../application/marketing/MarketingService';
import type { ToolResult } from '../../application/tools/toolTypes';
import { parseOptionalBody, z } from './requestBody';

/**
 * One anonymous tool run. `visitorId` / `toolId` / `result` stay optional so the
 * handler's own "Invalid tracking payload" still answers.
 *
 * `result` is the client's already-computed public result, stored VERBATIM as
 * JSON and rendered back by the same tool — so it is admitted as any JSON object
 * and never key-stripped or deep-validated (the handler only ever required it to
 * be present; a per-metric schema here would silently drop runs of tools whose
 * result shape evolves). `touch` is first-touch attribution, kept loose likewise.
 */
const TrackBody = z.object({
  visitorId: z.string().nullish(),
  toolId: z.string().nullish(),
  input: z.record(z.string(), z.number()).nullish(),
  result: z
    .custom<ToolResult>((value) => typeof value === 'object' && value !== null && !Array.isArray(value))
    .nullish(),
  touch: z
    .looseObject({
      landingPath: z.string().nullish(),
      referrer: z.string().nullish(),
      userAgent: z.string().nullish(),
      utm: z.record(z.string(), z.string()).nullish(),
    })
    .nullish(),
});

/** `isValidVisitorId` answers its own 400. */
const ConvertBody = z.object({ visitorId: z.string().nullish() });

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
    const body = await parseOptionalBody(c, TrackBody);

    if (!isValidVisitorId(body.visitorId) || typeof body.toolId !== 'string' || !body.toolId || !body.result) {
      return c.json({ error: 'Invalid tracking payload' }, 400);
    }

    await marketing.trackToolRun(c.env as Env, {
      visitorId: body.visitorId,
      toolId: body.toolId.slice(0, 64),
      input: body.input ?? {},
      result: body.result,
      touch: body.touch ?? undefined,
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
    const body = await parseOptionalBody(c, ConvertBody);
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    await marketing.markConverted(c.env as Env, body.visitorId, userId);
    return c.body(null, 204);
  });

  return router;
}
