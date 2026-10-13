/**
 * The operator's Insights credit grant — `POST /api/admin/replay-ops/grants`
 * (PRD 33 D17).
 *
 *   body { tenantId, units, reason }  →  { auditId, reference, units, credits } (201)
 *
 * Superadmin only (its own `superAdminMiddleware`, so the guard does not depend on
 * which router happens to be mounted on the prefix first). The grant is audited
 * BEFORE it is ledgered and the ledger reference names the audit row
 * (`replay-grant:<audit id>`) — see `application/commerce/replayCreditGrant.ts`.
 *
 * Its own small router rather than another block in `adminRoutes.ts`; it shares the
 * `/api/admin/replay-ops` prefix with the data plane's aggregate routes. A
 * presentation adapter only.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle } from '../../application/shared/dbHandle';
import { grantReplayCredits } from '../../application/commerce/replayCreditGrant';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { parseBody, z } from './requestBody';

const GrantBody = z.object({
  tenantId: z.number().int().positive(),
  units: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export function createReplayOpsGrantRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('/grants', superAdminMiddleware);

  router.post('/grants', async (c) => {
    const body = await parseBody(c, GrantBody);
    const result = await grantReplayCredits(db, c.env, {
      actorId: c.get('userId') as string,
      tenantId: body.tenantId,
      units: body.units,
      reason: body.reason,
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json(result, 201);
  });

  return router;
}
