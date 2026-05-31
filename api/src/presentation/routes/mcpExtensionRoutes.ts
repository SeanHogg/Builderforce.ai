/**
 * Tenant MCP extension management — /api/tenants/:tenantId/mcp-extensions
 *
 * Registers, lists, updates, and removes the custom MCP servers a tenant's Brain
 * can call. Tenant-scoped, owner-only — these extensions run server-to-server
 * with a stored secret and can act on the tenant's behalf.
 *
 * Auth: tenant-scoped JWT (Authorization: Bearer <jwt>). Role: OWNER.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import {
  createMcpExtension,
  listMcpExtensions,
  updateMcpExtension,
  deleteMcpExtension,
} from '../../application/llm/mcpExtensionService';

export function createMcpExtensionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.OWNER));

  // Reject any request whose URL :tenantId disagrees with the JWT's tenant.
  router.use('*', async (c, next) => {
    const urlTenantId = Number(c.req.param('tenantId'));
    const jwtTenantId = c.get('tenantId') as number | undefined;
    if (!Number.isFinite(urlTenantId) || urlTenantId !== jwtTenantId) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  });

  // POST /api/tenants/:tenantId/mcp-extensions — register an extension
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req
      .json<{ name?: string; serverUrl?: string; secret?: string | null }>()
      .catch(() => ({} as { name?: string; serverUrl?: string; secret?: string | null }));
    const name = (body.name ?? '').trim();
    const serverUrl = (body.serverUrl ?? '').trim();
    if (!name || !serverUrl) {
      return c.json({ error: 'name and serverUrl are required' }, 400);
    }
    try {
      const ext = await createMcpExtension(db, {
        tenantId,
        name,
        serverUrl,
        secret: body.secret ?? null,
        createdByUserId: userId,
        keyMaterial: c.env.JWT_SECRET,
      });
      return c.json(ext, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Failed to create extension' }, 400);
    }
  });

  // GET /api/tenants/:tenantId/mcp-extensions
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const extensions = await listMcpExtensions(db, tenantId);
    return c.json({ extensions });
  });

  // PATCH /api/tenants/:tenantId/mcp-extensions/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req
      .json<{ name?: string; serverUrl?: string; enabled?: boolean; secret?: string | null }>()
      .catch(() => ({} as { name?: string; serverUrl?: string; enabled?: boolean; secret?: string | null }));
    try {
      const updated = await updateMcpExtension(db, {
        tenantId,
        id,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.serverUrl === 'string' ? { serverUrl: body.serverUrl } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(body.secret !== undefined ? { secret: body.secret } : {}),
        keyMaterial: c.env.JWT_SECRET,
      });
      if (!updated) return c.json({ error: 'Extension not found or no fields to update' }, 404);
      return c.json({ extension: updated });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Failed to update extension' }, 400);
    }
  });

  // DELETE /api/tenants/:tenantId/mcp-extensions/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const ok = await deleteMcpExtension(db, { tenantId, id });
    if (!ok) return c.json({ error: 'Extension not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
