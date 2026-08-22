/**
 * Points routes — /api/points
 *
 * Open to ANY signed-in member, deliberately and with no role gate: everybody
 * earns, so everybody reads their own summary. Every handler is scoped to the
 * CALLER — there is no "read somebody else's points" shape here, which is what
 * keeps a leaderboard from becoming a way to enumerate colleagues' activity.
 *
 * The leaderboard is the one cross-member read, and it returns refs and totals
 * only: no actions, no timestamps, nothing about what anybody did.
 *
 * Awarding is NOT here. Points are a side effect of a domain event, so
 * `awardPoints` is called from the place the event happens; an HTTP endpoint that
 * mints points on request would be the farming vector the whole catalog of daily
 * caps exists to close.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { pointsLeaderboard, pointsSummary } from '../../application/points/pointsSummary';
import { cancelRedemption, redeemPoints } from '../../application/points/redeemPoints';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Refusals the caller caused (400) vs. ones the server owes them (409/503). */
const REFUSAL_STATUS: Record<string, 400 | 402 | 409 | 503> = {
  unknown_sku: 400,
  unavailable: 503,
  insufficient_points: 402,
  suspended: 409,
  fulfilment_failed: 503,
};

export function createPointsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /api/points ─────────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    return c.json(await pointsSummary(db, c.env as Env, tenantId, userId));
  });

  // ── GET /api/points/leaderboard ─────────────────────────────────────────
  router.get('/leaderboard', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ rows: await pointsLeaderboard(db, c.env as Env, tenantId, limit) });
  });

  // ── POST /api/points/redeem ─────────────────────────────────────────────
  router.post('/redeem', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ skuId?: string }>().catch(() => ({ skuId: undefined }));
    if (!body.skuId) return c.json({ error: 'skuId is required' }, 400);

    const result = await redeemPoints(db, c.env as Env, { tenantId, userId, skuId: body.skuId });
    if (!result.ok) return c.json({ error: result.reason }, REFUSAL_STATUS[result.reason] ?? 400);
    return c.json(result);
  });

  // ── POST /api/points/redemptions/:id/cancel ─────────────────────────────
  //
  // The caller's OWN pending redemption. `cancelRedemption` refuses anything that
  // is not pending, so a fulfilled reward cannot be un-bought.
  router.post('/redemptions/:id/cancel', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid redemption id' }, 400);

    const cancelled = await cancelRedemption(db, c.env as Env, tenantId, userId, id);
    if (!cancelled) return c.json({ error: 'not_pending' }, 409);
    return c.json({ ok: true });
  });

  return router;
}
