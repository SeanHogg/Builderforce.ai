import { Hono, type Context } from 'hono';
import { WORKSPACE_TOKEN_ROUTE } from '@builderforce/device-auth';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TenantService } from '../../application/tenant/TenantService';
import { assertLiveEditorKey } from '../../application/llm/editorKeyGate';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import { authMiddleware } from '../middleware/authMiddleware';
import { claimsFromContext } from '../middleware/requestClaims';
import { parseBody, z } from './requestBody';

const WorkspaceTokenBody = z.object({ tenantId: z.number().int().positive() });

export function workspaceTokenHandler(db: Db, tenantService: TenantService) {
  return async (c: Context<HonoEnv>, tenantId: number) => {
    const userId = c.get('userId') as string;
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
      // A token with no kid is unchecked, and one minted from it would carry no kid either - it
      // could renew itself forever after its key is revoked, so the gate sends it back to the key.
      const gate = await assertLiveEditorKey(db, {
        keyId: c.get('apiKeyId'),
        userId,
        missingKey: 'session_stale',
        requireRescope: tenantId !== c.get('tenantId'),
      });
      if (!gate.ok) {
        // The 401 has always been a bare `{ error }`; only the 403 outcomes carry a `code`.
        return c.json(gate.status === 401 ? { error: gate.message } : { error: gate.message, code: gate.code }, gate.status);
      }
    }
    const member = (await tenantService.listTenantsForUser(userId)).find((t) => t.id === tenantId);
    if (!member) return c.json({ error: 'Not a member of this workspace' }, 403);
    // Role is resolved from the caller's active membership inside the minter, so an
    // owner/manager switching workspaces keeps their real authority (not a flat dev token).
    const claims = claimsFromContext(c);
    const { token, expiresIn } = await mintTenantSessionToken(db, c.env.JWT_SECRET, {
      userId,
      tenantId,
      ...claims,
      // The app that asked keeps its own surface across the switch (Synapse, Spawn).
      clientSurface: claims.clientSurface ?? 'vscode',
      // `claims.keyId` carries the key forward, so a switch FROM this token is checked against it.
    });
    return c.json({ token, expiresIn, tenantId });
  };
}

export function createWorkspaceTokenRoutes(db: Db, tenantService: TenantService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const mint = workspaceTokenHandler(db, tenantService);
  router.post(WORKSPACE_TOKEN_ROUTE, authMiddleware, async (c) => {
    const { tenantId } = await parseBody(c, WorkspaceTokenBody);
    return mint(c, tenantId);
  });
  return router;
}
