/**
 * Tenant MCP extension management — /api/tenants/:tenantId/mcp-extensions
 *
 * Registers, lists, updates, and removes the custom MCP servers a tenant's Brain
 * can call, plus the two flows that make a registration a REAL external-MCP
 * client rather than a URL and a pasted secret:
 *
 *   • three-legged OAuth  — `GET .../:id/oauth/connect` builds the consent URL
 *     (discovering the server's authorization server and registering as a
 *     client if needed); `GET /api/mcp-oauth/callback` is the PUBLIC redirect
 *     target, authenticated by the signed `state` rather than a session, exactly
 *     like the mailbox/drive/calendar callbacks.
 *   • per-tool consent — folded into the existing PATCH as `allowedTools`.
 *
 * Tenant-scoped, owner-only for everything except the public callback — these
 * extensions run server-to-server and can act on the tenant's behalf.
 *
 * Auth: tenant-scoped JWT (Authorization: Bearer <jwt>). Role: OWNER.
 */
import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  createMcpExtension,
  listMcpExtensions,
  updateMcpExtension,
  deleteMcpExtension,
  invalidateMcpToolsCache,
} from '../../application/llm/mcpExtensionService';
import { normalizeAllowedTools } from '../../application/llm/mcp/mcpToolConsent';
import type { McpProtocol } from '../../application/llm/mcp/mcpWireClient';
import {
  beginMcpOAuthConnect,
  completeMcpOAuthConnect,
  MCP_OAUTH_CALLBACK_PATH,
} from '../../application/llm/mcp/mcpOAuthConnect';
import { clearGrant } from '../../application/llm/mcp/mcpExtensionAuth';

const DEFAULT_RETURN_TO = '/settings/integrations';
const VALID_PROTOCOLS: readonly McpProtocol[] = ['auto', 'mcp', 'legacy'];

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
      await invalidateMcpToolsCache(c.env, tenantId);
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
      .json<{
        name?: string;
        serverUrl?: string;
        enabled?: boolean;
        secret?: string | null;
        allowedTools?: string[] | null;
        protocol?: string;
      }>()
      .catch(() => ({} as Record<string, unknown>));
    let allowedTools: string[] | null | undefined;
    try {
      if (body.allowedTools !== undefined) allowedTools = normalizeAllowedTools(body.allowedTools);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Invalid allowedTools' }, 400);
    }
    if (body.protocol !== undefined && !VALID_PROTOCOLS.includes(body.protocol as McpProtocol)) {
      return c.json({ error: `protocol must be one of ${VALID_PROTOCOLS.join(', ')}` }, 400);
    }
    try {
      const updated = await updateMcpExtension(db, {
        tenantId,
        id,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.serverUrl === 'string' ? { serverUrl: body.serverUrl } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.secret === 'string' || body.secret === null ? { secret: body.secret } : {}),
        ...(allowedTools !== undefined ? { allowedTools } : {}),
        ...(body.protocol !== undefined ? { protocol: body.protocol as McpProtocol } : {}),
        keyMaterial: c.env.JWT_SECRET,
      });
      if (!updated) return c.json({ error: 'Extension not found or no fields to update' }, 404);
      await invalidateMcpToolsCache(c.env, tenantId);
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
    await invalidateMcpToolsCache(c.env, tenantId);
    return c.json({ ok: true });
  });

  /**
   * GET /api/tenants/:tenantId/mcp-extensions/:id/oauth/connect — build the
   * consent URL. Returned as JSON (not a 302) for the same reason every other
   * connect endpoint on the platform is: a top-level navigation cannot carry the
   * bearer token, so the browser must make the jump itself after this authed call.
   */
  router.get('/:id/oauth/connect', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const env = c.env as Env;
    const redirectUri = `${resolveAppBaseUrl(env).replace(/\/+$/, '')}${MCP_OAUTH_CALLBACK_PATH}`;
    try {
      const result = await beginMcpOAuthConnect(db, env, {
        tenantId,
        extensionId: id,
        userId,
        redirectUri,
        returnTo: c.req.query('returnTo'),
      });
      if (!result.ok) {
        const status = result.reason === 'not_found' ? 404 : 409;
        return c.json({ error: result.message, code: result.reason }, status);
      }
      return c.json({ authUrl: result.authorizeUrl });
    } catch (e) {
      reportCaughtError(e, { source: 'presentation/routes/mcpExtensionRoutes.ts', operation: 'oauth.connect' });
      return c.json({ error: e instanceof Error ? e.message : 'Failed to start authorization' }, 502);
    }
  });

  // DELETE /api/tenants/:tenantId/mcp-extensions/:id/oauth — revoke the grant
  // (the registration is kept, so reconnecting does not re-register a client).
  router.delete('/:id/oauth', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await clearGrant(db, { tenantId, extensionId: id });
    await invalidateMcpToolsCache(c.env, tenantId);
    return c.json({ ok: true });
  });

  return router;
}

/**
 * `GET /api/mcp-oauth/callback` — the PUBLIC callback every registered
 * authorization server redirects back to. Mounted separately (not under
 * `:tenantId`) because a dynamically-registered OAuth client declares ONE fixed
 * redirect URI up front; the extension and tenant ride in the signed `state`
 * instead, exactly like {@link ../../application/shared/providerOAuthConnect}'s
 * three other callers.
 *
 * Authenticated by the signed state, not a session — the browser arrives here
 * with no bearer token, straight from the authorization server's redirect.
 */
export function createMcpOAuthCallbackRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', async (c) => {
    const env = c.env as Env;
    const base = resolveAppBaseUrl(env);
    const code = c.req.query('code');
    const rawState = c.req.query('state');
    const redirectUri = `${base.replace(/\/+$/, '')}${MCP_OAUTH_CALLBACK_PATH}`;

    // The user declining consent is a normal outcome, not an error.
    if (c.req.query('error')) return c.redirect(`${base}${DEFAULT_RETURN_TO}?mcp=declined`);
    if (!code || !rawState) return c.redirect(`${base}${DEFAULT_RETURN_TO}?mcp=error`);

    const result = await completeMcpOAuthConnect(db, env, { rawState, code, redirectUri });
    const returnTo = result.returnTo ?? DEFAULT_RETURN_TO;
    if (!result.ok) {
      if (result.reason === 'exchange_failed') {
        reportCaughtError(new Error(result.message), {
          source: 'presentation/routes/mcpExtensionRoutes.ts',
          operation: 'oauth.callback',
        });
      }
      return c.redirect(`${base}${returnTo}?mcp=${result.reason === 'exchange_failed' ? 'error' : result.reason}`);
    }
    return c.redirect(`${base}${returnTo}?mcp=connected`);
  });

  return router;
}
