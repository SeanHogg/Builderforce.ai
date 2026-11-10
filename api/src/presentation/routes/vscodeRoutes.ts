import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { listVscodeConnections, upsertVscodeConnection } from '../../application/vscode/vscodeConnections';
import { resolveEditorIdentity } from '../../application/vscode/editorIdentity';
import { listOpenTasksAssignedTo } from '../../application/vscode/assignedTasks';
import type { TenantService } from '../../application/tenant/TenantService';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import { resolveEditorKeySession } from '../../application/llm/gatewayAccess';
import { parseOptionalBody, z } from './requestBody';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { WORKSPACES_PATH, workspaceHandlers } from './workspaceHandlers';

/** `POST /connect` — a bare heartbeat is valid; both fields have defaults. */
const ConnectBody = z.object({
  machineName: z.string().nullish(),
  extensionVersion: z.string().nullish(),
});

/**
 * VS Code coder-agent connection tracking + in-editor workspace (tenant) management.
 * Authenticated with a tenant JWT (exchanged from the editor's tenant API key via
 * /api/auth/tenant-api-key-token), so the signed-in USER is known (c.get('userId'))
 * even though the key is bound to ONE tenant. That lets the editor enumerate / create /
 * switch the user's OTHER workspaces without a browser round-trip. Listing and
 * creating now live at the person-level GET/POST /api/tenants; the switch stays here.
 */
export function createVscodeRoutes(db: Db, tenantService: TenantService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/vscode/me — the signed-in user's id, so the editor can filter the task
  // tree to "assigned to me" (compared against tasks.assignedUserId). The editor's key
  // is bound to a tenant but the exchanged JWT still carries the human's userId.
  // `displayName` rides along (additive) so the editor can name who reviewed a knowledge pack. Never the email.
  router.get('/me', async (c) => c.json(await resolveEditorIdentity(db, c.get('userId') as string)));

  // GET/POST /api/vscode/tenants — legacy aliases of GET/POST /api/tenants (the
  // canonical path accepts this editor's workspace token too). Kept for shipped
  // editors and mobile apps; same handlers, so the list still lands pending
  // invitations and the create still seeds the built-in agents.
  const workspaces = workspaceHandlers(db, tenantService);
  router.get('/tenants', legacyAliasNotice(WORKSPACES_PATH), workspaces.list);
  router.post('/tenants', legacyAliasNotice(WORKSPACES_PATH), workspaces.create);

  // POST /api/vscode/tenants/:id/token — SWITCH workspace: mint a tenant-scoped editor
  // JWT for :id, but ONLY if the caller is a member (so the editor can act on another
  // of the user's workspaces using its single bound key as proof of identity).
  router.post('/tenants/:id/token', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = Number(c.req.param('id'));
    if (!Number.isFinite(tenantId) || tenantId <= 0) return c.json({ error: 'invalid tenant id' }, 400);
    // A session derived from an editor KEY carries the server-signed device `src` (web
    // sessions carry none and switch freely). While the key is the session's authority:
    //   - a revoked / unknown / foreign key may not keep renewing derived JWTs: 401, which the
    //     editor answers by re-exchanging the key (and signing out if it is really dead);
    //   - a switch to ANOTHER workspace also needs the key to pass the gateway's editor-key
    //     bar (the same predicate), so the picker never selects a workspace the gateway will
    //     refuse: 403 `editor_key_required`;
    //   - a token with no `kid` was minted before it was stamped: it cannot be checked, but
    //     the key may be perfectly fine, so it is `session_stale` (re-exchange and retry),
    //     never a verdict on the key - whether or not the target is its own workspace.
    if (c.get('clientSurface')) {
      const keyId = c.get('apiKeyId');
      const crossTenant = tenantId !== c.get('tenantId');
      if (!keyId) {
        // Unchecked, and a token minted from it would carry no kid either - it could renew
        // itself forever after its key is revoked. Always send it back to the key.
        return c.json({ error: 'Session predates key tracking; exchange the key again.', code: 'session_stale' }, 403);
      } else {
        const key = await resolveEditorKeySession(db, keyId, userId);
        if (!key.valid) return c.json({ error: 'Invalid or revoked API key' }, 401);
        if (crossTenant && !key.mayRescope) {
          return c.json({
            error: 'Only an unrestricted, server-only editor key issued by device sign-in can act in another workspace.',
            code: 'editor_key_required',
          }, 403);
        }
      }
    }
    const member = (await tenantService.listTenantsForUser(userId)).find((t) => t.id === tenantId);
    if (!member) return c.json({ error: 'Not a member of this workspace' }, 403);
    // Role is resolved from the caller's active membership inside the minter, so an
    // owner/manager switching workspaces keeps their real authority (not a flat dev token).
    const { token, expiresIn } = await mintTenantSessionToken(db, c.env.JWT_SECRET, {
      userId,
      tenantId,
      // The app that asked keeps its own surface across the switch (Synapse, Spawn).
      clientSurface: c.get('clientSurface') ?? 'vscode',
      // Carry the key forward, so a switch FROM this token is checked against the same key.
      ...(c.get('apiKeyId') ? { keyId: c.get('apiKeyId') } : {}),
      userAgent: c.req.header('User-Agent') ?? null,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ token, expiresIn, tenantId });
  });

  // POST /api/vscode/connect — register or heartbeat this VS Code connection.
  router.post('/connect', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const body = await parseOptionalBody(c, ConnectBody);
    const machineName = (body.machineName ?? '').slice(0, 255) || 'vscode';
    const extensionVersion = (body.extensionVersion ?? '').slice(0, 32) || null;

    await upsertVscodeConnection(db, c.env, { tenantId, userId, machineName, extensionVersion });

    return c.json({ ok: true });
  });

  // GET /api/vscode/tasks — the OPEN work items assigned to the signed-in user, so the
  // editor can deliver assigned tasks (tracked HITL) and notify on newly-assigned work.
  // A task is assigned to a human OR an agent (never both), so this is the "assigned to
  // me" delivery channel that mirrors the web board's human-assignee lane. Bounded to 50
  // and open-only (completedAt IS NULL). Intentionally uncached: a low-QPS interactive
  // poll that MUST reflect a just-assigned task immediately — same posture as
  // /api/tenants and /connections.
  router.get('/tasks', async (c) => {
    const rows = await listOpenTasksAssignedTo(db, c.get('tenantId') as number, c.get('userId') as string);
    return c.json({ tasks: rows });
  });

  // GET /api/vscode/connections — list this tenant's VS Code connections (for the
  // workforce/observability surface). The dashboard polls it every 30 s, so it reads
  // through a short cache that `/connect` invalidates.
  router.get('/connections', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ connections: await listVscodeConnections(db, c.env, tenantId) });
  });

  return router;
}
