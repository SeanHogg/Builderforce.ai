import { Hono } from 'hono';
import { WORKSPACE_TOKEN_PATH } from '@builderforce/device-auth';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { listVscodeConnections, upsertVscodeConnection } from '../../application/vscode/vscodeConnections';
import { resolveEditorIdentity } from '../../application/vscode/editorIdentity';
import { listOpenTasksAssignedTo } from '../../application/vscode/assignedTasks';
import type { TenantService } from '../../application/tenant/TenantService';
import { parseOptionalBody, z } from './requestBody';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { workspaceTokenHandler } from './workspaceTokenRoutes';
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
 * creating now live at the person-level GET/POST /api/tenants; the editor switch endpoint is a compatibility alias.
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

  const mintWorkspaceToken = workspaceTokenHandler(db, tenantService);
  router.post('/tenants/:id/token', legacyAliasNotice(WORKSPACE_TOKEN_PATH), (c) =>
    mintWorkspaceToken(c, Number(c.req.param('id'))),
  );

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
