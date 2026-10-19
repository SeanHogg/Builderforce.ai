/**
 * Founder-facing advisory sessions.
 *
 * Booking reuses `reserve` — the same write practice-ops and the talent Book
 * CTA already use — so overlap, host binding and the meeting link are not
 * reimplemented here. The list is the founder's own upcoming rows, including
 * sessions written in an advisor's tenant by continue-with-advisor.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { BookingError, reserve } from '../../application/commerce/bookings';
import { listFounderAdvisorSessions } from '../../application/commerce/continueAdvisor';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireTenantId } from '../middleware/tenantContext';
import { parseBody, z } from './requestBody';

const BookBody = z.object({
  serviceId: z.number().int().positive(),
  startsAt: z.string().min(1),
  hostRef: z.string().min(1).max(64).optional(),
  timezone: z.string().max(64).optional(),
});

export function createAdvisoryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/sessions', async (c) => {
    const sessions = await listFounderAdvisorSessions(db, {
      founderRef: c.get('userId') as string,
    });
    return c.json({ sessions });
  });

  const tenant = (c: Parameters<typeof requireTenantId>[0]) => requireTenantId(c);
  const who = (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  router.post('/sessions', async (c) => {
    const body = await parseBody(c, BookBody);
    const startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BookingError('startsAt must be a valid date', 400);
    const booked = await reserve(db, c.env as Env, tenant(c), await who(c), {
      serviceId: body.serviceId,
      startsAt,
      ...(body.hostRef != null ? { hostRef: body.hostRef } : {}),
      bookerRef: c.get('userId') as string,
      ...(body.timezone != null ? { timezone: body.timezone } : {}),
    });
    return c.json(booked, 201);
  });

  return router;
}
