import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { vscodeConnections } from '../../infrastructure/database/schema';
import type { TenantService } from '../../application/tenant/TenantService';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import { TenantRole } from '../../domain/shared/types';

/**
 * VS Code coder-agent connection tracking + in-editor workspace (tenant) management.
 * Authenticated with a tenant JWT (exchanged from the editor's tenant API key via
 * /api/auth/tenant-api-key-token), so the signed-in USER is known (c.get('userId'))
 * even though the key is bound to ONE tenant. That lets the editor enumerate / create /
 * switch the user's OTHER workspaces without a browser round-trip — the userId-scoped
 * equivalent of the web-only /api/tenants/{mine,create} (which require a web session).
 */
export function createVscodeRoutes(db: Db, tenantService: TenantService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/vscode/tenants — workspaces the signed-in user belongs to.
  // Intentionally uncached: low-QPS interactive call (only when opening the workspace
  // picker) that MUST reflect a just-created workspace immediately — same posture as
  // the web /api/tenants/mine. Doubles as the membership source for the switch below.
  router.get('/tenants', async (c) => {
    const userId = c.get('userId') as string;
    const tenants = await tenantService.listTenantsForUser(userId);
    return c.json({ tenants });
  });

  // POST /api/vscode/tenants — create a workspace; the caller becomes its owner.
  router.post('/tenants', async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const tenant = await tenantService.createTenant({ name, ownerUserId: userId });
    return c.json(tenant.toPlain(), 201);
  });

  // POST /api/vscode/tenants/:id/token — SWITCH workspace: mint a tenant-scoped editor
  // JWT for :id, but ONLY if the caller is a member (so the editor can act on another
  // of the user's workspaces using its single bound key as proof of identity).
  router.post('/tenants/:id/token', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = Number(c.req.param('id'));
    if (!Number.isFinite(tenantId) || tenantId <= 0) return c.json({ error: 'invalid tenant id' }, 400);
    const member = (await tenantService.listTenantsForUser(userId)).find((t) => t.id === tenantId);
    if (!member) return c.json({ error: 'Not a member of this workspace' }, 403);
    const { token, expiresIn } = await mintTenantSessionToken(db, c.env.JWT_SECRET, {
      userId,
      tenantId,
      role: TenantRole.DEVELOPER,
      userAgent: c.req.header('User-Agent') ?? null,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ token, expiresIn, tenantId });
  });

  // POST /api/vscode/connect — register or heartbeat this VS Code connection.
  router.post('/connect', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const body = await c.req
      .json<{ machineName?: string; extensionVersion?: string }>()
      .catch(() => ({} as { machineName?: string; extensionVersion?: string }));
    const machineName = (body.machineName ?? '').slice(0, 255) || 'vscode';
    const extensionVersion = (body.extensionVersion ?? '').slice(0, 32) || null;

    const [existing] = await db
      .select({ id: vscodeConnections.id })
      .from(vscodeConnections)
      .where(
        and(
          eq(vscodeConnections.tenantId, tenantId),
          eq(vscodeConnections.userId, userId),
          eq(vscodeConnections.machineName, machineName),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(vscodeConnections)
        .set({ status: 'active', extensionVersion, lastSeenAt: sql`now()` })
        .where(eq(vscodeConnections.id, existing.id));
    } else {
      await db.insert(vscodeConnections).values({ tenantId, userId, machineName, extensionVersion });
    }

    return c.json({ ok: true });
  });

  // GET /api/vscode/connections — list this tenant's VS Code connections (for the
  // workforce/observability surface). Cached read is unnecessary: small, rarely polled.
  router.get('/connections', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(vscodeConnections)
      .where(eq(vscodeConnections.tenantId, tenantId))
      .orderBy(desc(vscodeConnections.lastSeenAt))
      .limit(100);
    return c.json({ connections: rows });
  });

  return router;
}
