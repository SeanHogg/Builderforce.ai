import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { recordVisitorEvents, type VisitorEventInput } from '../../application/marketing/VisitorEventService';

/**
 * The anonymous visitor journey — the PUBLIC write path.
 *
 * `POST /events` takes a batch of journey events keyed by the opaque marketing
 * `visitorId`: a visit starting, the pages they moved through, an error they
 * hit, the visit ending. The signed-in activity tracker never fires for a
 * logged-out visitor, so without this the platform could see what someone ASKED
 * for (`marketing_session_prompts`) and whether they eventually signed up, with
 * nothing at all in between.
 *
 * It replaced `POST /api/demo/events`, which was the same endpoint scoped to the
 * persona demo. Keeping both would have meant two validators and two abuse
 * ceilings for one stream; the demo now posts here with its persona attached.
 *
 * Unauthenticated by necessity — it runs on marketing pages that never mint a
 * token — so it trusts nothing beyond the opaque visitor id, bounds the batch,
 * and answers 202 for every outcome. A visitor who trips an abuse ceiling must
 * still get where they were going: the status is reported, never enforced.
 */
export function createVisitorRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/events', async (c) => {
    const body = await c.req
      .json<{ visitorId?: string; events?: VisitorEventInput[] }>()
      .catch((): Record<string, never> => ({}));

    const result = await recordVisitorEvents(buildDatabase(c.env), c.env as Env, {
      visitorId: body.visitorId,
      ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      events: Array.isArray(body.events) ? body.events : [],
    });

    return result.ok
      ? c.json({ status: 'recorded', accepted: result.accepted }, 202)
      : c.json({ status: result.reason, accepted: 0 }, 202);
  });

  return router;
}
