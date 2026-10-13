/**
 * Marketplace CAPABILITIES — `/api/capabilities` (PRD 33 §4.2 steps 3 and 7;
 * `REPLAY_PATHS.capabilityState`, `capabilityPacks`, `capabilityPackCheckout`).
 *
 *   GET  /:slug/state                                → CapabilityStateDto   any member
 *   GET  /session-replay/packs                       → ReplayPackDto[]      any member
 *   POST /session-replay/packs/:packId/checkout      → { checkoutUrl }      MANAGER + billing:manage
 *
 * The state read is deliberately NOT gated on the capability: it is how a surface
 * learns whether to show the install gate. Buying a pack is a billing act, so it is
 * gated like every other checkout (`requireRole(MANAGER)` + `BILLING_MANAGE`); an
 * unconfigured payment provider answers 503 (`ReplayCommerceError`, rendered by the
 * global handler through its `status`). A presentation adapter only.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { TenantRole } from '../../domain/shared/types';
import { NotFoundError } from '../../domain/shared/errors';
import { PERMISSIONS } from '../../domain/permissions/permissionRegistry';
import { capabilityState } from '../../application/tenant/capabilityState';
import { loadReplayPacks, startReplayPackCheckout } from '../../application/commerce/replayPacks';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { parseBody, z } from './requestBody';

const CheckoutBody = z.object({ returnUrl: z.string().trim().min(1) });

export function createCapabilityRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:slug/state', async (c) => {
    const slug = c.req.param('slug');
    const state = await capabilityState(c.env, db, {
      tenantId: c.get('tenantId') as number,
      userId: (c.get('userId') as string | undefined) ?? null,
      slug,
    });
    if (!state) throw new NotFoundError('Capability', slug);
    return c.json(state);
  });

  router.get('/session-replay/packs', async (c) => {
    const packs = await loadReplayPacks(c.env, db);
    return c.json(packs.map((pack) => ({ id: pack.id, units: pack.units, amountCents: pack.amountCents })));
  });

  router.post(
    '/session-replay/packs/:packId/checkout',
    requireRole(TenantRole.MANAGER),
    requirePermission(PERMISSIONS.BILLING_MANAGE),
    async (c) => {
      const body = await parseBody(c, CheckoutBody);
      const userId = c.get('userId') as string;
      const started = await startReplayPackCheckout(db, c.env, {
        tenantId: c.get('tenantId') as number,
        buyerRef: userId,
        actorId: userId,
        packId: c.req.param('packId'),
        returnUrl: body.returnUrl,
      });
      return c.json({ checkoutUrl: started.checkoutUrl });
    },
  );

  return router;
}
