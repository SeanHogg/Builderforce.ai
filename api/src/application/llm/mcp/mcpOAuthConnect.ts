/**
 * Connecting a tenant's MCP server through its own authorization server — the
 * two halves of the browser round trip.
 *
 * `mcpOAuth` knows the protocol and `mcpExtensionAuth` knows the storage; this is
 * the flow that joins them, and it exists as its own module for the same reason
 * {@link ../../shared/providerOAuthConnect} does: the two things easiest to get
 * subtly wrong in an OAuth callback are the CSRF story and `returnTo`, and both
 * must be answered identically everywhere.
 *
 *   • CSRF — the callback is a top-level browser redirect carrying no bearer
 *     token, so the HMAC-signed `state` naming the tenant, the user and the
 *     extension is the only thing authenticating it.
 *   • `returnTo` — constrained to a path on our own app by the SAME `safeReturnTo`
 *     the other three connect flows use, so a crafted value round-tripped through
 *     a hostile authorization server cannot make this an open redirect.
 *
 * The one genuine difference from the mailbox/drive/calendar flows, and why this
 * cannot simply call them: there, the OAuth client is configured per DEPLOYMENT
 * in env vars, and the provider is one of a fixed registry. Here the server is
 * whatever the tenant registered, and we discover its authorization server and
 * register ourselves with it at connect time (RFC 7591).
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { tenantMcpExtensions } from '../../../infrastructure/database/schema';
import { signState, verifyState } from '../../../infrastructure/auth/oauthState';
import { safeReturnTo } from '../../shared/providerOAuthConnect';
import {
  buildAuthorizeUrl,
  createPkcePair,
  discoverAuthorizationServer,
  discoverEndpoints,
  exchangeMcpCode,
  registerClient,
  type McpOAuthRegistration,
} from './mcpOAuth';
import { openRegistration, sealRegistration, storeGrant } from './mcpExtensionAuth';
import { listRemoteTools, McpAuthChallenge } from './mcpWireClient';
import type { McpProtocol } from './mcpWireClient';

/** Where an OAuth'd MCP server sends the browser back. ONE fixed path, because a
 *  dynamically-registered client declares its redirect URI up front and cannot
 *  vary it per extension — the extension id rides in the signed state instead. */
export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp-oauth/callback';

/** What the signed `state` carries across the round trip. */
interface McpConnectState extends Record<string, unknown> {
  kind: 'mcp-extension';
  extensionId: string;
  tenantId: number;
  userId: string;
  returnTo: string;
}

const DEFAULT_RETURN_TO = '/settings/integrations';

async function loadRow(db: Db, tenantId: number, extensionId: string) {
  const [row] = await db
    .select()
    .from(tenantMcpExtensions)
    .where(and(eq(tenantMcpExtensions.id, extensionId), eq(tenantMcpExtensions.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/**
 * Ask the server what it wants, discover its authorization server, register if
 * needed, and return the consent URL for the browser to navigate to.
 *
 * The probe is a real unauthenticated `tools/list`: a server that answers it needs
 * no OAuth at all, and saying so is more useful than sending a human to a consent
 * screen for a grant nothing will ever check. `challenge` from the 401 is what
 * points at the protected-resource metadata.
 */
export async function beginMcpOAuthConnect(
  db: Db,
  env: Env,
  args: {
    tenantId: number;
    extensionId: string;
    userId: string;
    /** Absolute callback URL — must be exactly what is registered with the AS. */
    redirectUri: string;
    returnTo?: string;
  },
): Promise<
  | { ok: true; authorizeUrl: string }
  | { ok: false; reason: 'not_found' | 'no_auth_required'; message: string }
> {
  const row = await loadRow(db, args.tenantId, args.extensionId);
  if (!row) return { ok: false, reason: 'not_found', message: 'Extension not found' };

  let challenge: string | null = null;
  try {
    await listRemoteTools({
      serverUrl: row.serverUrl,
      authorization: null,
      protocol: row.protocol as McpProtocol,
    });
    return {
      ok: false,
      reason: 'no_auth_required',
      message: 'This MCP server answered without authorization; there is nothing to connect.',
    };
  } catch (err) {
    if (!(err instanceof McpAuthChallenge)) throw err;
    challenge = err.challenge;
  }

  const { resource, authorizationServer } = await discoverAuthorizationServer(row.serverUrl, challenge);
  const endpoints = await discoverEndpoints(authorizationServer);

  // Reuse the client we already registered with this authorization server; only
  // register a new one when we have none, so reconnecting after a revocation does
  // not leave a trail of orphaned client registrations behind.
  const existing = await openRegistration(env, args.tenantId, row);
  const client = existing?.clientId
    ? { clientId: existing.clientId, ...(existing.clientSecret ? { clientSecret: existing.clientSecret } : {}) }
    : endpoints.registrationEndpoint
      ? await registerClient(endpoints.registrationEndpoint, args.redirectUri, endpoints.scopes)
      : (() => {
        throw new Error('This authorization server does not support dynamic client registration');
      })();

  const registration: McpOAuthRegistration = { resource, ...endpoints, ...client };
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const sealed = await sealRegistration(env, args.tenantId, { ...registration, codeVerifier });
  await db
    .update(tenantMcpExtensions)
    .set({ oauthEnc: sealed.enc, oauthIv: sealed.iv })
    .where(and(eq(tenantMcpExtensions.id, row.id), eq(tenantMcpExtensions.tenantId, args.tenantId)));

  const state = await signState(env.JWT_SECRET, {
    kind: 'mcp-extension',
    extensionId: row.id,
    tenantId: args.tenantId,
    userId: args.userId,
    returnTo: safeReturnTo(args.returnTo, DEFAULT_RETURN_TO),
  } satisfies McpConnectState);

  return { ok: true, authorizeUrl: buildAuthorizeUrl(registration, { redirectUri: args.redirectUri, state, codeChallenge }) };
}

export type McpCallbackResult =
  | { ok: true; returnTo: string }
  | { ok: false; reason: 'invalid_state' | 'no_pending_consent' | 'exchange_failed'; returnTo: string | null; message: string };

/**
 * The callback half: verify the state, prove the PKCE verifier, seal the grant.
 *
 * The verifier is CONSUMED — cleared from the stored registration on success — so
 * a replayed callback cannot mint a second grant from the same consent.
 */
export async function completeMcpOAuthConnect(
  db: Db,
  env: Env,
  args: { rawState: string; code: string; redirectUri: string },
): Promise<McpCallbackResult> {
  const state = await verifyState<McpConnectState>(env.JWT_SECRET, args.rawState);
  if (!state || state.kind !== 'mcp-extension') {
    return { ok: false, reason: 'invalid_state', returnTo: null, message: 'Invalid or expired authorization state' };
  }
  const returnTo = safeReturnTo(state.returnTo, DEFAULT_RETURN_TO);

  const row = await loadRow(db, state.tenantId, state.extensionId);
  const consent = row ? await openRegistration(env, state.tenantId, row) : null;
  if (!row || !consent?.codeVerifier) {
    return { ok: false, reason: 'no_pending_consent', returnTo, message: 'No authorization was in flight for this server' };
  }

  try {
    const tokens = await exchangeMcpCode(consent, args.code, args.redirectUri);
    await storeGrant(db, env, {
      tenantId: state.tenantId,
      extensionId: row.id,
      tokens: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expires_in ? { expiresAtMs: Date.now() + tokens.expires_in * 1000 } : {}),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
      },
    });
    // Burn the verifier: the consent it proves has been spent.
    const { codeVerifier: _spent, ...registration } = consent;
    const sealed = await sealRegistration(env, state.tenantId, { ...registration, codeVerifier: '' });
    await db
      .update(tenantMcpExtensions)
      .set({ oauthEnc: sealed.enc, oauthIv: sealed.iv })
      .where(and(eq(tenantMcpExtensions.id, row.id), eq(tenantMcpExtensions.tenantId, state.tenantId)));
    return { ok: true, returnTo };
  } catch (error) {
    return {
      ok: false,
      reason: 'exchange_failed',
      returnTo,
      message: error instanceof Error ? error.message : 'Token exchange failed',
    };
  }
}
