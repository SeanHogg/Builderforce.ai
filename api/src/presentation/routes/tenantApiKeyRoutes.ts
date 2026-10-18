/**
 * Tenant API key management — ONE router, two scopes.
 *
 *   /api/tenants/:tenantId/api-keys        — the workspace OWNER, own workspace only
 *   /api/admin/tenants/:tenantId/api-keys  — a platform superadmin, any workspace
 *
 * Issues, lists, and revokes `bfk_*` keys that authorize calls to the
 * builderforceLLM gateway (`/llm/v1/chat/completions`). These keys can spend
 * the tenant's plan-day token budget.
 *
 * The superadmin console used to carry its own five handlers over the same
 * service calls. The scopes differ only in who may ask and on whose behalf, so
 * that is all the scope decides here: the owner scope adds the JWT-tenant match,
 * the owner role and the per-verb permissions; the admin scope relies on the
 * superadmin gate of the router it is mounted in. The mint/list/revoke logic
 * itself lives in `application/llm/tenantApiKeyService.ts`.
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { optionalTenantId } from '../middleware/tenantContext';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS, type Permission } from '../../domain/permissions/permissionRegistry';
import { TenantRole } from '../../domain/shared/types';
import { requestDb } from '../../application/shared/dbHandle';
import {
  mintTenantApiKey,
  listTenantApiKeys,
  queryTenantApiKeyUsage,
  revokeTenantApiKey,
  updateTenantApiKey,
  isTenantApiScope,
} from '../../application/llm/tenantApiKeyService';
import { limitParam } from './queryParams';
import { parseBody, parseOptionalBody, z } from './requestBody';

/** Origins arrive as a list of strings (or null = server-only); `normalizeOrigins` shapes them. */
const OriginsField = z.array(z.string()).nullable().optional();
const MintKeyBody = z.object({
  name: z.string().nullish(),
  allowedOrigins: OriginsField,
  scopes: z.array(z.string()).optional(),
});
const PatchKeyBody = z.object({
  name: z.string().nullish(),
  allowedOrigins: OriginsField,
});

/**
 * Normalize a caller-supplied origins array — trim, drop empties, enforce
 * `https?://...` shape (or the literal `'*'`). Returns `null` for empty/missing
 * input so the column stores SQL NULL (server-only key).
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

/** Who is asking, and for which workspace. */
export type TenantApiKeyScope = 'tenant_owner' | 'platform_admin';

const passThrough: MiddlewareHandler<HonoEnv> = async (_c, next) => { await next(); };

function buildTenantApiKeyRouter(scope: TenantApiKeyScope, dbOf: (c: Context<HonoEnv>) => Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const admin = scope === 'platform_admin';
  // The admin scope's authorization is the superadmin gate it is mounted behind;
  // per-verb tenant permissions describe a MEMBER's grants and do not apply.
  const may = (permission: Permission) => (admin ? passThrough : requirePermission(permission));

  if (!admin) {
    router.use('*', authMiddleware);
    router.use('*', requireRole(TenantRole.OWNER));
  }

  // The owner scope refuses a URL :tenantId that disagrees with the JWT's
  // tenant; the admin scope acts on whichever valid id the URL names.
  router.use('*', async (c, next) => {
    const urlTenantId = Number(c.req.param('tenantId'));
    if (admin && !Number.isFinite(urlTenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    if (!admin && (!Number.isFinite(urlTenantId) || urlTenantId !== optionalTenantId(c))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  });
  // Both scopes have verified the URL id above, so it IS the workspace acted on.
  const tenantOf = (c: Context<HonoEnv>) => Number(c.req.param('tenantId'));

  // POST — mint a new bfk_* key. The owner may pass `scopes` to mint a
  // least-privilege service token (unknown scopes are dropped); an admin-issued
  // key is always a full-tenant gateway key.
  router.post('/', may(PERMISSIONS.APIKEY_ROTATE), async (c) => {
    const body = admin ? await parseOptionalBody(c, MintKeyBody) : await parseBody(c, MintKeyBody);
    const minted = await mintTenantApiKey(dbOf(c), {
      tenantId: tenantOf(c),
      name: (body.name ?? '').trim() || (admin ? 'Admin-issued tenant API key' : 'Tenant API Key'),
      createdByUserId: (c.get('userId') as string | undefined) ?? null,
      allowedOrigins: normalizeOrigins(body.allowedOrigins),
      ...(admin ? {} : { scopes: body.scopes ? body.scopes.filter(isTenantApiScope) : null }),
    });
    return c.json(minted, 201);
  });

  router.get('/', may(PERMISSIONS.APIKEY_READ), async (c) => {
    return c.json({ keys: await listTenantApiKeys(dbOf(c), tenantOf(c)) });
  });

  // GET /:keyId/usage — per-key audit trail
  router.get('/:keyId/usage', may(PERMISSIONS.APIKEY_READ), async (c) => {
    const result = await queryTenantApiKeyUsage(dbOf(c), {
      tenantId: tenantOf(c),
      keyId: c.req.param('keyId'),
      days: Number(c.req.query('days') ?? '30'),
      page: Number(c.req.query('page') ?? '1'),
      limit: limitParam(c.req.query('limit'), 100, 500),
    });
    return c.json(result);
  });

  // PATCH /:keyId — partial update (name, allowedOrigins)
  router.patch('/:keyId', may(PERMISSIONS.APIKEY_ROTATE), async (c) => {
    const body = admin ? await parseOptionalBody(c, PatchKeyBody) : await parseBody(c, PatchKeyBody);
    const updated = await updateTenantApiKey(dbOf(c), {
      tenantId: tenantOf(c),
      keyId: c.req.param('keyId'),
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(body.allowedOrigins !== undefined ? { allowedOrigins: normalizeOrigins(body.allowedOrigins) } : {}),
      env: c.env,
    });
    if (!updated) return c.json({ error: 'Key not found, revoked, or no fields to update' }, 404);
    return c.json({ key: updated });
  });

  router.delete('/:keyId', may(PERMISSIONS.APIKEY_DELETE), async (c) => {
    const ok = await revokeTenantApiKey(dbOf(c), { tenantId: tenantOf(c), keyId: c.req.param('keyId'), env: c.env });
    if (!ok) return c.json({ error: 'Key not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}

/** Mounted at `/api/tenants/:tenantId/api-keys` — the owner, own workspace. */
export function createTenantApiKeyRoutes(db: Db): Hono<HonoEnv> {
  return buildTenantApiKeyRouter('tenant_owner', () => db);
}

/** Mounted inside the superadmin router at `/tenants/:tenantId/api-keys`. */
export function createPlatformTenantApiKeyRoutes(): Hono<HonoEnv> {
  return buildTenantApiKeyRouter('platform_admin', requestDb);
}
