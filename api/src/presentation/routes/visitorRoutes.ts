import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { recordVisitorEvents } from '../../application/marketing/VisitorEventService';
import { RequestValidationError } from '../../domain/shared/errors';
import { parseOptionalBody, z } from './requestBody';

/**
 * A journey batch. Nothing here can refuse: `recordVisitorEvents` validates the
 * visitor id (answering `invalid_visitor`) and every event field itself, so the
 * schema's job is only to guarantee `events` is an array of OBJECTS — a `null` or
 * scalar entry used to reach `event.kind` as a TypeError.
 */
const VisitorEventBody = z.looseObject({
  kind: z.unknown().optional(), visitId: z.unknown().optional(), persona: z.unknown().optional(),
  path: z.unknown().optional(), metadata: z.unknown().optional(), occurredAt: z.unknown().optional(),
});
const VisitorBatchBody = z.object({
  visitorId: z.unknown().optional(),
  events: z.preprocess(
    (value) => (Array.isArray(value) ? value.filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e)) : []),
    z.array(VisitorEventBody),
  ),
});

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
 *
 * Takes its `Db` from the composition root rather than calling `buildDatabase`
 * itself: a route may not reach into infrastructure, and the handle already
 * exists one layer up. The event write itself was always an application service
 * (`recordVisitorEvents`) — this closes the last import.
 */
export function createVisitorRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/events', async (c) => {
    // A body that is not an object at all (an array, a string) reads as an empty
    // batch rather than a 400: this endpoint answers 202 for every outcome.
    const body = await parseOptionalBody(c, VisitorBatchBody).catch((e: unknown) => {
      if (e instanceof RequestValidationError) return VisitorBatchBody.parse({});
      throw e;
    });

    const result = await recordVisitorEvents(db, c.env as Env, {
      visitorId: body.visitorId,
      ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      events: body.events,
    });

    return result.ok
      ? c.json({ status: 'recorded', accepted: result.accepted }, 202)
      : c.json({ status: result.reason, accepted: 0 }, 202);
  });

  return router;
}
