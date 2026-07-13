/**
 * BI bridge — /api/bi/* (spec 05 §4.1).
 *
 * BuilderForce-internal consumers (cost-per-point, runway-aware sprint caps) read
 * the host's burn/runway for the caller's Segment here. End-user authed; the
 * outbound call to the host uses the per-tenant BI config + token (read:bi.burn).
 * Returns `{ available: false }` when the host BI isn't configured/reachable so
 * the UI falls back to manual burn input.
 *
 * Host BI config (`tenants.settings.hostBi = { baseUrl, token }`) is read by
 * burnRateService; this router also EXPOSES it for self-serve set/rotate so an
 * owner no longer has to hand-edit the raw settings JSON. The token is never
 * returned on read (only a `hasToken` flag), mirroring the API-keys panel.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { fetchBurnRate } from '../../application/seams/burnRateService';
import { fetchValidationEngagements } from '../../application/seams/validationEngagementsService';
import { tenants } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

function parseSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Read the stored host-BI config (baseUrl + token) from a settings blob. */
function readHostBi(raw: string | null | undefined): { baseUrl: string | null; token: string | null } {
  const hostBi = parseSettings(raw).hostBi as { baseUrl?: unknown; token?: unknown } | undefined;
  return {
    baseUrl: typeof hostBi?.baseUrl === 'string' ? hostBi.baseUrl : null,
    token: typeof hostBi?.token === 'string' ? hostBi.token : null,
  };
}

export function createBiRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/burn-rate', async (c) => {
    const tenantId = c.get('tenantId');
    const segmentId = c.get('segmentId') as string;
    const result = await fetchBurnRate(db, { tenantId, segmentId });
    return c.json(result);
  });

  // Validation-engagements proxy (spec 05 §4.2 PM-4): list the host's feedback
  // widgets / validation cohorts for this segment, to overlay on the VoC inbox.
  // Reuses the same host BI config + segment scope as burn-rate; degrades to
  // `{ available: false }` so the inbox still renders the stored feedback.
  router.get('/validation-engagements', async (c) => {
    const tenantId = c.get('tenantId');
    const segmentId = c.get('segmentId') as string;
    const result = await fetchValidationEngagements(db, { tenantId, segmentId });
    return c.json(result);
  });

  // ── Host BI config (set/rotate the read:bi.burn endpoint + token) ──────────
  // Read the current config (token is NEVER returned — only whether one is set).
  router.get('/config', async (c) => {
    const tenantId = c.get('tenantId');
    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const cfg = readHostBi(row?.settings);
    return c.json({ baseUrl: cfg.baseUrl, hasToken: !!cfg.token });
  });

  // Set or rotate the host BI base URL + token. MANAGER+. The token is write-only
  // (never echoed back). Omitting `token` on a PUT keeps the existing one (a
  // baseUrl-only rotation); pass it to rotate. baseUrl must be https.
  router.put('/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{ baseUrl?: string; token?: string }>().catch(() => ({}) as { baseUrl?: string; token?: string });
    const baseUrl = (body.baseUrl ?? '').trim();
    if (!/^https:\/\/[^\s]+$/.test(baseUrl)) {
      return c.json({ error: 'baseUrl must be an https URL' }, 400);
    }

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = parseSettings(row?.settings);
    const prior = readHostBi(row?.settings);

    // Keep the existing token on a baseUrl-only update; rotate when a new token is
    // supplied. Enabling for the first time requires a token (else the read path
    // is half-configured and silently returns `not_configured`).
    const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : prior.token;
    if (!token) {
      return c.json({ error: 'token is required to configure host BI' }, 400);
    }

    const hostBi = { baseUrl: baseUrl.replace(/\/+$/, ''), token };
    settings.hostBi = hostBi;
    await db
      .update(tenants)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return c.json({ baseUrl: hostBi.baseUrl, hasToken: true });
  });

  // Clear the host BI config (disconnect). MANAGER+.
  router.delete('/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = parseSettings(row?.settings);
    delete settings.hostBi;
    await db
      .update(tenants)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    return c.json({ ok: true });
  });

  return router;
}
