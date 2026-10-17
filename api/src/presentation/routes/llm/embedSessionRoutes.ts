/**
 * POST /v1/embed-session — server-to-server relay token mint.
 *
 * A customer's backend calls this with its `bfk_*` key (no browser Origin —
 * requireTenantAccess enforces the origin allowlist, so a server-only key is rejected
 * from a browser) and receives a SHORT-LIVED tenant-scoped JWT. The customer hands
 * that token to its browser, which then calls the gateway directly — the bfk_* secret
 * never leaves the server. The minted token's `sub` is `embed:<keyId>`, recognised as
 * a service token by requireTenantAccess (no tenant_members row required).
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { mintEmbedSessionToken } from '../../../application/llm/gatewayAccess';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

const EMBED_SESSION_TTL_SECONDS = 600; // 10 minutes; the relay refreshes.

export function mountEmbedSessionRoutes(router: Hono<HonoEnv>): void {
  router.post('/v1/embed-session', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Only a tenant API key may mint embed sessions. A JWT (web/agentHost/embed)
    // can't — that would let a browser token bootstrap fresh tokens forever.
    if (!access.tenantApiKeyId) {
      return c.json(
        {
          error: 'embed-session requires a tenant API key (bfk_*) sent server-to-server.',
          code: 'embed_requires_api_key',
        },
        403,
      );
    }

    const token = await mintEmbedSessionToken(c.env, access.tenantApiKeyId, access.tenantId, EMBED_SESSION_TTL_SECONDS);
    return c.json({
      token,
      expiresInSeconds: EMBED_SESSION_TTL_SECONDS,
      expiresAt: new Date(Date.now() + EMBED_SESSION_TTL_SECONDS * 1000).toISOString(),
    });
  });
}
