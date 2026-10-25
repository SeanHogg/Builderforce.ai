/**
 * POST /provider-keys/:provider/local-credential — issue a connected subscription's
 * short-lived access token to a runtime on the member's own machine. See
 * `application/llm/localCredential.ts` for why, and why only the access token.
 *
 *   200 { provider, runtime, accessToken, expiresAt, baseUrl, models[] }
 *   404 { code: 'provider_not_connected' }        → the client offers to connect
 *   409 { code: 'provider_reconnect_required' }   → the stored grant is dead; connect again
 *
 * Body (optional): `{ rejected }` — the access token the provider just refused although it
 * had not expired (a second sign-in on the same account revoked it). When it is the token we
 * hold, the grant is rotated now instead of handing the same dead token back.
 *
 * POST, not GET: resolving may ROTATE the stored grant, and nothing between the client
 * and us should ever cache or prefetch a credential. `no-store` says the same to anything
 * that would.
 *
 * Members only. An agent-host or embed token has no person behind it, and this hands out
 * a personal credential — those callers already reach the provider through the relay,
 * where the token never leaves the request.
 */
import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { isSupportedProvider } from '../../application/llm/tenantProviderKeyService';
import { issueLocalCredential, supportsLocalCredential } from '../../application/llm/localCredential';
import { parseOptionalBody, z } from './requestBody';

/** The narrow auth shape this module needs — `TenantAccess` satisfies it structurally. */
export interface LocalCredentialGate {
  requireTenantAccess(c: Context<HonoEnv>): Promise<{ tenantId: number; userId: string | null }>;
  respondToAccessError(c: Context<HonoEnv>, err: unknown): Response;
}

export function mountLocalCredentialRoutes(router: Hono<HonoEnv>, gate: LocalCredentialGate): void {
  router.post('/provider-keys/:provider/local-credential', async (c) => {
    let access: { tenantId: number; userId: string | null };
    try { access = await gate.requireTenantAccess(c); } catch (err) { return gate.respondToAccessError(c, err); }
    c.header('Cache-Control', 'no-store');
    if (!access.userId) {
      return c.json({ error: 'A local credential is issued to a signed-in member only.', code: 'member_required' }, 403);
    }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider) || !supportsLocalCredential(provider)) {
      return c.json({ error: `${provider} cannot be used from a local runtime.`, code: 'unsupported_provider' }, 400);
    }

    // Optional: a plain request carries no body at all.
    const { rejected } = await parseOptionalBody(c, z.object({ rejected: z.string().min(1).optional() }));
    const result = await issueLocalCredential(c.env, access.tenantId, provider, Date.now(), rejected);
    switch (result.kind) {
      case 'credential':
        return c.json(result.body);
      case 'not_connected':
        return c.json({ error: `${provider} is not connected to this workspace.`, code: 'provider_not_connected' }, 404);
      case 'reconnect':
        return c.json({
          error: result.reason === 'api_key_connection'
            ? `This workspace connected ${provider} with an API key. Connect the subscription to use it on this machine.`
            : `The ${provider} connection needs to be renewed — connect it again.`,
          code: 'provider_reconnect_required',
          reason: result.reason,
        }, 409);
      default:
        return c.json({ error: `${provider} cannot be used from a local runtime.`, code: 'unsupported_provider' }, 400);
    }
  });
}
