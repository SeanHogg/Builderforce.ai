import type { Handler } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TenantService } from '../../application/tenant/TenantService';
import { createWorkspace, listMyWorkspaces } from '../../application/tenant/myWorkspaces';
import { parseBody, z } from './requestBody';

/** The canonical "my workspaces" path; every other list/create path is an alias of it. */
export const WORKSPACES_PATH = '/api/tenants';

/** `name` is left optional so a missing one gets the use case's own sentence; malformed JSON is a 400. */
const CreateWorkspaceBody = z.object({ name: z.string().nullish() });

/**
 * The ONE list handler and the ONE create handler for the caller's own
 * workspaces. Mounted at `GET`/`POST /api/tenants` (canonical) and, stamped with
 * `legacyAliasNotice(WORKSPACES_PATH)`, at `/api/auth/my-tenants`,
 * `/api/tenants/mine`, `/api/tenants/create` and `/api/vscode/tenants` — each
 * alias keeps the auth middleware it always had; the handler is shared.
 */
export function workspaceHandlers(db: Db, tenantService: TenantService): { list: Handler<HonoEnv>; create: Handler<HonoEnv> } {
  return {
    list: async (c) => c.json(await listMyWorkspaces(db, c.env as Env, tenantService, c.get('userId') as string)),
    create: async (c) => {
      const body = await parseBody(c, CreateWorkspaceBody);
      const result = await createWorkspace(db, tenantService, { name: body.name, ownerUserId: c.get('userId') as string });
      if (!result.ok) return c.json({ error: 'name is required' }, 400);
      return c.json(result.tenant.toPlain(), 201);
    },
  };
}
