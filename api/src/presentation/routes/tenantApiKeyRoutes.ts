/**
 * Tenant API key management — /api/tenants/:tenantId/api-keys
 *
 * Issues, lists, and revokes `bfk_*` keys that authorize calls to the
 * builderforceLLM gateway (`/llm/v1/chat/completions`). Tenant-scoped,
 * owner-only — these keys can spend the tenant's plan-day token budget.
 *
 * Auth: tenant-scoped JWT (Authorization: Bearer <jwt>).
 * Role: OWNER.
 *
 * The mint/list/revoke logic itself lives in
 * `application/llm/tenantApiKeyService.ts` so the superadmin
 * `adminRoutes.ts` flow can share it without duplication.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import {
  mintTenantApiKey,
  listTenantApiKeys,
  revokeTenantApiKey,
  updateTenantApiKey,
} from '../../application/llm/tenantApiKeyService';

/**
 * Normalize a caller-supplied origins array — trim, drop empties, enforce
 * `https?://...` shape (or the literal `'*'`). Returns `null` for empty/missing
 * input so the column stores SQL NULL (server-only key). Single helper used
 * by both mint endpoints (DRY).
 */
export function normalizeOrigins(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => s === '*' || /^https?:\/\/[^\s]+$/.test(s));
  return cleaned.length > 0 ? cleaned : null;
}

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
    const body     = await c.req.json<{ name?: string; allowedOrigins?: string[] | null }>()
      .catch(() => ({} as { name?: string; allowedOrigins?: string[] | null }));
    const name     = (body.name ?? '').trim() || 'Tenant API Key';
    const allowedOrigins = normalizeOrigins(body.allowedOrigins);

    const minted = await mintTenantApiKey(db, { tenantId, name, createdByUserId: userId, allowedOrigins });
    return c.json(minted, 201);
  });

  // GET /api/tenants/:tenantId/api-keys
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const keys = await listTenantApiKeys(db, tenantId);
    return c.json({ keys });
  });

  // PATCH /api/tenants/:tenantId/api-keys/:keyId — partial update (name, allowedOrigins)
  router.patch('/:keyId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const keyId    = c.req.param('keyId');
    const body     = await c.req.json<{ name?: string; allowedOrigins?: string[] | null }>()
      .catch(() => ({} as { name?: string; allowedOrigins?: string[] | null }));

    const updated = await updateTenantApiKey(db, {
      tenantId,
      keyId,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(body.allowedOrigins !== undefined ? { allowedOrigins: normalizeOrigins(body.allowedOrigins) } : {}),
      env: c.env,
    });
    if (!updated) return c.json({ error: 'Key not found, revoked, or no fields to update' }, 404);
    return c.json({ key: updated });
  });

  // DELETE /api/tenants/:tenantId/api-keys/:keyId
  router.delete('/:keyId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const keyId    = c.req.param('keyId');
    const ok = await revokeTenantApiKey(db, { tenantId, keyId, env: c.env });
    if (!ok) return c.json({ error: 'Key not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
