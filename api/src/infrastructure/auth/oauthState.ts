/**
 * Shared OAuth primitives — HMAC-signed CSRF `state` (no DB round-trip) and the
 * authorization-code → token exchange. Keep it here so the crypto lives in
 * exactly one place.
 *
 * Two callers, and only two:
 *
 *   • {@link ../../presentation/routes/oauthRoutes} — the login/signup/link
 *     flow, where the grant establishes WHO the user is.
 *   • {@link ../../application/shared/providerOAuthConnect} — the connect flow
 *     for a third party the user already owns (mailbox, drive, calendar).
 *
 * A route connecting a new provider surface should call the latter rather than
 * this module: this is infrastructure, and a route importing it directly fails
 * `npm run check:layering`.
 */

import { hexToBytes, randomHex } from '../../domain/shared/bytes';
import { hmacHex, hmacVerify } from '../crypto/hmac';

/**
 * Sign an arbitrary state payload. A random `nonce` and issue timestamp `ts` are
 * stamped in automatically, so two calls with the same payload differ and the
 * verifier can enforce a freshness window.
 */
export async function signState(secret: string, payload: Record<string, unknown>): Promise<string> {
  const nonce = randomHex(16);
  const body = JSON.stringify({ ...payload, nonce, ts: Date.now() });
  return btoa(body + '|' + (await hmacHex(secret, body)));
}

/**
 * Verify + decode a signed state. Returns the original payload (including
 * `nonce`/`ts`) or `null` if the signature is bad or the state is older than
 * `maxAgeMs` (default 10 minutes).
 */
export async function verifyState<T extends Record<string, unknown>>(
  secret: string,
  state: string,
  maxAgeMs = 10 * 60 * 1000,
): Promise<(T & { ts: number }) | null> {
  try {
    const decoded = atob(state);
    const sep = decoded.lastIndexOf('|');
    if (sep < 0) return null;
    const body = decoded.slice(0, sep);
    const sigHex = decoded.slice(sep + 1);
    const ok = await hmacVerify(secret, body, hexToBytes(sigHex));
    if (!ok) return null;
    const parsed = JSON.parse(body) as T & { ts: number };
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  /** Seconds until the access token expires. */
  expires_in?: number;
  scope?: string;
}

/**
 * The OAuth client this deployment presents at the token endpoint.
 *
 * `clientSecret` is OPTIONAL because a PUBLIC client is a real, spec-legal case:
 * an MCP server's authorization server may register us dynamically (RFC 7591)
 * with `token_endpoint_auth_method: none`, and sending an empty `client_secret`
 * form field is rejected by strict authorization servers. `extra` carries the
 * per-flow parameters the base grant does not define — PKCE's `code_verifier`
 * and RFC 8707's `resource` — so there is still exactly ONE token exchange in
 * the codebase rather than a second copy per protocol.
 */
export interface TokenClient {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
}

function tokenForm(cfg: TokenClient, fields: Record<string, string>, extra?: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    client_id: cfg.clientId,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    ...fields,
    ...(extra ?? {}),
  });
}

/**
 * Exchange an authorization code for tokens (RFC 6749 §4.1.3). Returns the raw
 * token set including `refresh_token`/`expires_in`/`scope` when the provider
 * supplies them.
 */
export async function exchangeCodeForTokens(
  cfg: TokenClient,
  code: string,
  redirectUri: string,
  extra?: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenForm(cfg, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' }, extra),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error('No access_token in response');
  return data;
}

/**
 * Refresh an access token with a stored refresh token (RFC 6749 §6). Google may
 * omit a new refresh_token (keep the old one); Microsoft rotates it.
 */
export async function refreshAccessToken(
  cfg: TokenClient,
  refreshToken: string,
  extra?: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenForm(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' }, extra),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error('No access_token in refresh response');
  return data;
}
