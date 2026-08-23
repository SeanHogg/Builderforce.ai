/**
 * Three-legged OAuth for an external MCP server — discovery, dynamic client
 * registration, PKCE.
 *
 * A static bearer token was the only way to authenticate to a registered MCP
 * server, which meant a tenant either had a long-lived secret to paste or could
 * not connect the server at all. The MCP authorization specification says the
 * grant belongs to the HUMAN, and describes how a client that has never met the
 * server finds its way to a consent screen:
 *
 *   1. call the server → `401` with `WWW-Authenticate: Bearer resource_metadata=…`
 *   2. fetch the PROTECTED RESOURCE metadata → which authorization server(s) it trusts
 *   3. fetch that authorization server's metadata (RFC 8414 / OIDC discovery)
 *   4. register ourselves as a client if we have not (RFC 7591 dynamic registration)
 *   5. send the human to `authorization_endpoint` with PKCE + the `resource` the
 *      token must be audience-bound to (RFC 8707)
 *   6. exchange the code, keeping the verifier honest
 *
 * Every step above is a FETCH TO A URL THE FAR SERVER CHOSE, which is precisely
 * the surface the roadmap entry said had to be built deliberately. So each one
 * goes through the same guard as the tool traffic: https only, literal-IP and
 * internal-host rules, plus a live DoH resolution check immediately before the
 * request ({@link ../../../infrastructure/net/ssrfGuard}). Discovery documents are
 * also required to live on the SAME ORIGIN as the thing they describe, so a
 * compromised server cannot point discovery at somebody else's authorization
 * server and harvest a consent it was never granted.
 *
 * This module is pure protocol: it never touches the database. Sealing what it
 * returns is {@link ./mcpExtensionAuth}'s job.
 */

import {
  exchangeCodeForTokens,
  refreshAccessToken,
  type TokenResponse,
} from '../../../infrastructure/auth/oauthState';
import { assertSafeUrl, resolveAndAssertPublic } from '../../../infrastructure/net/ssrfGuard';

/** How this deployment identifies itself when registering with an unknown AS. */
const CLIENT_NAME = 'Builderforce';
const DISCOVERY_TIMEOUT_MS = 10_000;

/** The endpoints + client we discovered/registered for one MCP server. */
export interface McpOAuthRegistration {
  /** Canonical resource identifier the token is audience-bound to (RFC 8707). */
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  /** Scopes the authorization server advertises; empty when it declares none. */
  scopes: string[];
  clientId: string;
  clientSecret?: string;
}

/** A registration plus the PKCE verifier for the consent currently in flight. */
export interface McpOAuthPendingConsent extends McpOAuthRegistration {
  codeVerifier: string;
}

async function safeFetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const parsed = assertSafeUrl(url, { allowHttp: false });
  await resolveAndAssertPublic(parsed.hostname);
  const res = await fetch(parsed.toString(), {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    headers: { Accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

/**
 * The `resource_metadata` URL out of a `WWW-Authenticate` challenge, when the
 * server sent one. A server that sends no challenge is not an error: the spec's
 * fallback is the well-known path on the resource's own origin.
 */
export function resourceMetadataUrlFrom(challenge: string | null): string | null {
  if (!challenge) return null;
  const match = /resource_metadata\s*=\s*"?([^",\s]+)"?/i.exec(challenge);
  return match?.[1] ?? null;
}

/** Same-origin rule for a discovery document (see the module doc). */
function assertSameOrigin(expected: string, candidate: string, what: string): void {
  if (new URL(candidate).origin !== new URL(expected).origin) {
    throw new Error(`${what} must live on the same origin as the MCP server`);
  }
}

/**
 * Discover where an MCP server's grants come from.
 *
 * `challenge` is the raw `WWW-Authenticate` of the 401 we just took; absent, the
 * spec's default well-known location on the server's own origin is used.
 */
export async function discoverAuthorizationServer(
  serverUrl: string,
  challenge: string | null,
): Promise<{ resource: string; authorizationServer: string }> {
  const server = assertSafeUrl(serverUrl, { allowHttp: false });
  const advertised = resourceMetadataUrlFrom(challenge);
  if (advertised) assertSameOrigin(server.origin, advertised, 'Protected-resource metadata');
  const metadataUrl = advertised ?? `${server.origin}/.well-known/oauth-protected-resource`;

  const metadata = await safeFetchJson(metadataUrl);
  // A server with no protected-resource document is still connectable: the spec's
  // fallback is that the resource IS its own authorization server.
  const authServers = (metadata?.authorization_servers as unknown[] | undefined) ?? [];
  const authorizationServer = typeof authServers[0] === 'string' ? authServers[0] : server.origin;
  const resource = typeof metadata?.resource === 'string' ? metadata.resource : server.origin;
  return { resource, authorizationServer };
}

/**
 * Authorization-server metadata (RFC 8414, with the OIDC discovery document as
 * the fallback every real deployment also serves).
 */
export async function discoverEndpoints(authorizationServer: string): Promise<{
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopes: string[];
}> {
  const base = assertSafeUrl(authorizationServer, { allowHttp: false });
  const candidates = [
    `${base.origin}/.well-known/oauth-authorization-server${base.pathname === '/' ? '' : base.pathname}`,
    `${base.origin}/.well-known/openid-configuration`,
  ];
  for (const candidate of candidates) {
    const doc = await safeFetchJson(candidate).catch(() => null);
    const authorizationEndpoint = doc?.authorization_endpoint;
    const tokenEndpoint = doc?.token_endpoint;
    if (typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') continue;
    // The endpoints must belong to the authorization server that named them.
    assertSameOrigin(base.origin, authorizationEndpoint, 'Authorization endpoint');
    assertSameOrigin(base.origin, tokenEndpoint, 'Token endpoint');
    const registrationEndpoint = typeof doc?.registration_endpoint === 'string' ? doc.registration_endpoint : undefined;
    if (registrationEndpoint) assertSameOrigin(base.origin, registrationEndpoint, 'Registration endpoint');
    const scopes = Array.isArray(doc?.scopes_supported)
      ? (doc.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    return { authorizationEndpoint, tokenEndpoint, ...(registrationEndpoint ? { registrationEndpoint } : {}), scopes };
  }
  throw new Error('Authorization server published no usable metadata document');
}

/**
 * Register this deployment as a client (RFC 7591).
 *
 * Asked for as a PUBLIC client (`token_endpoint_auth_method: none`) because the
 * grant is protected by PKCE and a per-server confidential secret we would then
 * have to store adds a credential without adding a guarantee. An authorization
 * server that insists on issuing a secret anyway is honoured — it comes back in
 * the response and is sealed with the rest of the registration.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  scopes: string[],
): Promise<{ clientId: string; clientSecret?: string }> {
  const doc = await safeFetchJson(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    }),
  });
  const clientId = doc?.client_id;
  if (typeof clientId !== 'string' || !clientId) {
    throw new Error('Dynamic client registration returned no client_id');
  }
  const clientSecret = typeof doc?.client_secret === 'string' ? doc.client_secret : undefined;
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

// ── PKCE (RFC 7636, S256) ──────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh verifier + its S256 challenge. The verifier never leaves our storage. */
export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)) };
}

/** The consent URL the human is sent to. */
export function buildAuthorizeUrl(
  registration: McpOAuthRegistration,
  params: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: registration.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    // Audience-binds the token to THIS server, so a token minted for one MCP
    // server cannot be replayed against another that trusts the same AS.
    resource: registration.resource,
    ...(registration.scopes.length ? { scope: registration.scopes.join(' ') } : {}),
  });
  return `${registration.authorizationEndpoint}?${query}`;
}

/** Trade the authorization code for a grant, proving the PKCE verifier. */
export async function exchangeMcpCode(
  consent: McpOAuthPendingConsent,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const token = assertSafeUrl(consent.tokenEndpoint, { allowHttp: false });
  await resolveAndAssertPublic(token.hostname);
  return exchangeCodeForTokens(
    { tokenUrl: consent.tokenEndpoint, clientId: consent.clientId, ...(consent.clientSecret ? { clientSecret: consent.clientSecret } : {}) },
    code,
    redirectUri,
    { code_verifier: consent.codeVerifier, resource: consent.resource },
  );
}

/** Re-mint an access token from a stored refresh token. */
export async function refreshMcpToken(
  registration: McpOAuthRegistration,
  refreshToken: string,
): Promise<TokenResponse> {
  const token = assertSafeUrl(registration.tokenEndpoint, { allowHttp: false });
  await resolveAndAssertPublic(token.hostname);
  return refreshAccessToken(
    { tokenUrl: registration.tokenEndpoint, clientId: registration.clientId, ...(registration.clientSecret ? { clientSecret: registration.clientSecret } : {}) },
    refreshToken,
    { resource: registration.resource },
  );
}
