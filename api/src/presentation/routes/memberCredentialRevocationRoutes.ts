import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { revokeMemberCredentials, type MemberCredential } from '../../application/auth/memberCredentialRevocation';

/**
 * How a router establishes WHICH workspace a revocation acts in, and who may ask.
 * The workspace security page and the superadmin console differ only here; the
 * three handlers they used to each carry are registered once, below.
 */
export interface MemberRevocationScope {
  /** The workspace id, or the refusal to send instead. Runs before anything else. */
  tenantOf(c: Context<HonoEnv>): number | Response;
  dbOf(c: Context<HonoEnv>): Db;
  /** Route-level authorization (the workspace page's manager gate). */
  guard?: MiddlewareHandler<HonoEnv>;
}

/**
 * Registers, under `prefix` (which must declare `:userId`):
 *   POST {prefix}/sessions/:sessionId/revoke
 *   POST {prefix}/sessions/revoke-all
 *   POST {prefix}/tokens/:jti/revoke
 */
export function registerMemberCredentialRevocation(router: Hono<HonoEnv>, prefix: string, scope: MemberRevocationScope): void {
  const handle = (credentialOf: (c: Context<HonoEnv>) => MemberCredential | null, missing: string) =>
    async (c: Context<HonoEnv>) => {
      const tenantId = scope.tenantOf(c);
      if (tenantId instanceof Response) return tenantId;
      const userId = c.req.param('userId');
      const credential = credentialOf(c);
      if (!userId || !credential) return c.json({ error: missing }, 400);
      const result = await revokeMemberCredentials(scope.dbOf(c), c.env, { tenantId, userId, credential });
      if (!result.ok) return c.json({ error: 'User is not an active member of this tenant' }, 404);
      return c.json({ ok: true });
    };

  const routes: Array<[string, ReturnType<typeof handle>]> = [
    [`${prefix}/sessions/:sessionId/revoke`, handle((c) => {
      const sessionId = c.req.param('sessionId');
      return sessionId ? { sessionId } : null;
    }, 'userId and sessionId are required')],
    [`${prefix}/sessions/revoke-all`, handle(() => ({ all: true }), 'userId is required')],
    [`${prefix}/tokens/:jti/revoke`, handle((c) => {
      const jti = c.req.param('jti');
      return jti ? { jti } : null;
    }, 'userId and jti are required')],
  ];
  for (const [path, handler] of routes) {
    if (scope.guard) router.post(path, scope.guard, handler);
    else router.post(path, handler);
  }
}
