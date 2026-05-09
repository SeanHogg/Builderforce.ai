/**
 * Tenant API key management — /api/tenants/:tenantId/api-keys
 *
 * Issues, lists, and revokes `bfk_*` keys that authorize calls to the
 * builderforceLLM gateway (`/llm/v1/chat/completions`). Tenant-scoped,
 * owner-only — these keys can spend the tenant's plan-day token budget.
 *
 * Auth: tenant-scoped JWT (Authorization: Bearer <jwt>).
 * Role: OWNER.
 */
import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantApiKeys } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';

export function createTenantApiKeyRoutes(db: Db): Hono<HonoEnv> {
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

  // POST /api/tenants/:tenantId/api-keys — mint a new bfk_* key
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
    const name     = (body.name ?? '').trim() || 'Tenant API Key';

    const rawKey  = generateApiKey('bfk');
    const keyHash = await hashSecret(rawKey);

    const [row] = await db
      .insert(tenantApiKeys)
      .values({ tenantId, name, keyHash, createdByUserId: userId })
      .returning({
        id:        tenantApiKeys.id,
        name:      tenantApiKeys.name,
        createdAt: tenantApiKeys.createdAt,
      });

    return c.json({ key: rawKey, id: row!.id, name: row!.name, createdAt: row!.createdAt }, 201);
  });

  // GET /api/tenants/:tenantId/api-keys — list (no raw key returned)
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const rows = await db
      .select({
        id:               tenantApiKeys.id,
        name:             tenantApiKeys.name,
        createdByUserId:  tenantApiKeys.createdByUserId,
        lastUsedAt:       tenantApiKeys.lastUsedAt,
        revokedAt:        tenantApiKeys.revokedAt,
        createdAt:        tenantApiKeys.createdAt,
      })
      .from(tenantApiKeys)
      .where(eq(tenantApiKeys.tenantId, tenantId))
      .orderBy(desc(tenantApiKeys.createdAt));

    return c.json({ keys: rows });
  });

  // DELETE /api/tenants/:tenantId/api-keys/:keyId — revoke
  router.delete('/:keyId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const keyId    = c.req.param('keyId');

    const result = await db
      .update(tenantApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(tenantApiKeys.id, keyId),
        eq(tenantApiKeys.tenantId, tenantId),
        isNull(tenantApiKeys.revokedAt),
      ))
      .returning({ id: tenantApiKeys.id });

    if (result.length === 0) return c.json({ error: 'Key not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
