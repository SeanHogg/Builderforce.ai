/**
 * The operator's Insights credit grant and per-workspace switches —
 * `/api/admin/replay-ops` (PRD 33 D8, D9, D17).
 *
 *   POST  /grants                       body { tenantId, units, reason }
 *                                       → { auditId, reference, units, credits } (201)
 *   GET   /tenants/:tenantId/settings   → { replayExcluded, replayFreeAllowanceOverride }
 *   PATCH /tenants/:tenantId/settings   body ⊆ { replayExcluded: boolean,
 *                                       replayFreeAllowanceOverride: int ≥ 0 | null }
 *                                       → the settings after the change (audited,
 *                                       see `application/replay/replayTenantSettings.ts`)
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
import {
  getReplayTenantSettings,
  REPLAY_ALLOWANCE_OVERRIDE_MAX,
  updateReplayTenantSettings,
} from '../../application/replay/replayTenantSettings';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { parseBody, z } from './requestBody';
import { positiveIntParam } from './queryParams';

const GrantBody = z.object({
  tenantId: z.number().int().positive(),
  units: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

const SettingsBody = z.object({
  replayExcluded: z.boolean().optional(),
  replayFreeAllowanceOverride: z.number().int().min(0).max(REPLAY_ALLOWANCE_OVERRIDE_MAX).nullable().optional(),
}).strict().refine(
  (body) => body.replayExcluded !== undefined || body.replayFreeAllowanceOverride !== undefined,
  { message: 'Nothing to change' },
);

/** A junk id becomes 0, which the application rejects as a 400. */
function tenantIdParam(raw: string | undefined): number {
  return positiveIntParam(raw) ?? 0;
}

export function createReplayOpsGrantRoutes(db: DbHandle): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('/grants', superAdminMiddleware);
  router.use('/tenants/*', superAdminMiddleware);

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

  router.get('/tenants/:tenantId/settings', async (c) => {
    return c.json(await getReplayTenantSettings(db, tenantIdParam(c.req.param('tenantId'))));
  });

  router.patch('/tenants/:tenantId/settings', async (c) => {
    const tenantId = tenantIdParam(c.req.param('tenantId'));
    const patch = await parseBody(c, SettingsBody);
    const settings = await updateReplayTenantSettings(db, c.env, {
      actorId: c.get('userId') as string,
      tenantId,
      patch,
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json(settings);
  });

  return router;
}
