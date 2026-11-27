import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { resolveEditorKeySession } from '../../application/llm/gatewayAccess';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import {
  isScopedTokenAudience,
  SCOPED_TOKEN_AUDIENCES,
  SCOPED_TOKEN_TTL_SECONDS,
} from '../../application/auth/scopedTokenAudiences';
import { parseBody, z } from './requestBody';

const ScopedTokenBody = z.object({ audience: z.string().nullish() });

/**
 * POST /api/auth/scoped-token — body `{ audience }`. Requires the caller's normal tenant JWT
 * and returns `{ token, expiresAt }`: a 15-minute copy of it (same user, workspace, role,
 * surface and editor-key id) carrying `aud`, so a sibling extension can act on that audience's
 * routes without ever holding the full token. Minted through the ONE tenant-token minter.
 * An audience-bound token cannot reach this route (its audience does not list it) and is
 * refused here explicitly too, so a scoped token can never mint another. A caller whose
 * token carries an editor-key id must still hold a live key.
 */
export function createScopedTokenRoute(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.post('/scoped-token', authMiddleware, async (c) => {
    // A scoped token can never mint another (defence in depth: authMiddleware already
    // refuses it here because its audience does not list this route).
    if (c.get('tokenAudience')) {
      return c.json({ error: 'A scoped token cannot mint another token', code: 'token_audience_forbidden' }, 403);
    }
    // Only a person's own session mints: machine keys, cloud-agent replays and emulation
    // contexts must not obtain a token they could hand to another process.
    if (c.get('machineActor') || c.get('agentActorRef') || c.get('isEmulation')) {
      return c.json({ error: 'Only a signed-in user session can mint a scoped token', code: 'scoped_token_actor_forbidden' }, 403);
    }
    const { audience } = await parseBody(c, ScopedTokenBody);
    if (!isScopedTokenAudience(audience)) {
      return c.json({ error: 'Unknown audience', allowed: Object.keys(SCOPED_TOKEN_AUDIENCES) }, 400);
    }
    const userId = c.get('userId') as string;
    // An editor session is derived from a bfk_* key: a revoked / unknown / foreign key must
    // not keep minting (same check as the workspace switch in vscodeRoutes).
    const keyId = c.get('apiKeyId');
    if (keyId) {
      const key = await resolveEditorKeySession(db, keyId, userId);
      if (!key.valid) return c.json({ error: 'Invalid or revoked API key' }, 401);
    }
    const { token, expiresIn } = await mintTenantSessionToken(db, c.env.JWT_SECRET, {
      userId,
      // Linked to the parent login session so signing out / revoking it revokes this too.
      ...(c.get('sessionId') ? { sessionId: c.get('sessionId') } : {}),
      tenantId: c.get('tenantId') as number,
      role: c.get('role'),
      audience,
      expiresIn: SCOPED_TOKEN_TTL_SECONDS,
      clientSurface: c.get('clientSurface'),
      ...(keyId ? { keyId } : {}),
      userAgent: c.req.header('User-Agent') ?? null,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
  });
  return router;
}
