import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { authMiddleware } from '../middleware/authMiddleware';
import { mintScopedToken } from '../../application/auth/mintScopedToken';
import { isScopedTokenAudience, SCOPED_TOKEN_AUDIENCES } from '../../application/auth/scopedTokenAudiences';
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
    const result = await mintScopedToken(db, c.env, {
      claims: {
        userId: c.get('userId') as string,
        tenantId: c.get('tenantId') as number,
        role: c.get('role'),
        clientSurface: c.get('clientSurface'),
        userAgent: c.req.header('User-Agent') ?? null,
        ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      },
      audience,
      sessionId: c.get('sessionId'),
      apiKeyId: c.get('apiKeyId'),
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ token: result.token, expiresAt: result.expiresAt });
  });
  return router;
}
