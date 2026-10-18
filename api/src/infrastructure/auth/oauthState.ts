/**
 * Shared OAuth primitives — HMAC-signed CSRF `state` (no DB round-trip) and the
 * authorization-code → token exchange. Keep it here so the crypto lives in
 * exactly one place.
 *
 * The token half has ONE application-layer front door,
 * {@link ../../application/shared/providerOAuthConnect}: every connect flow
 * (mailbox, drive, calendar, payouts, ledger, YouTube, MCP, the subscription
 * providers) and the login/SSO exchanges go through it. The signed-state half is
 * also used directly by non-OAuth short-lived handoffs (unsubscribe links, LTI
 * deep-link pickers, session exchange codes) because it is a generic signed
 * envelope, not an OAuth concept.
 *
 * A route connecting a new provider surface should call the application module
 * rather than this one: this is infrastructure, and a route importing it directly
 * fails `npm run check:layering`.
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
  /** OIDC only — enterprise SSO verifies it; the connect flows ignore it. */
  id_token?: string;
}

/**
 * The OAuth client this deployment presents at the token endpoint.
 *
 * `clientSecret` is OPTIONAL because a PUBLIC client is a real, spec-legal case:
 * an MCP server's authorization server may register us dynamically (RFC 7591)
 * with `token_endpoint_auth_method: none`, the subscription providers (Claude,
 * ChatGPT, SuperGrok) publish one fixed public client id, and sending an empty
 * `client_secret` form field is rejected by strict authorization servers. `extra`
 * carries the per-flow parameters the base grant does not define — PKCE's
 * `code_verifier`, RFC 8707's `resource`, Anthropic's echoed `state` — so there
 * is still exactly ONE token request in the codebase rather than a copy per
 * protocol.
 */
export interface TokenClient {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  /**
   * How the grant is encoded. RFC 6749 says form-encoded and every provider but
   * one accepts that; Anthropic's console token endpoint only takes JSON. A
   * provider difference is DATA on the descriptor, never a second fetch.
   */
  bodyEncoding?: 'form' | 'json';
}

/**
 * A token endpoint said no (or said something unusable).
 *
 * Carries the upstream `status` and raw `body` because callers decide different
 * things from them: the refresh paths tell a revoked grant (400/401/403) from an
 * outage, and the subscription connect flow tells a spent authorization code
 * (`invalid_grant`) from an unentitled account. The message keeps the historical
 * `Token exchange failed: <status>` / `Token refresh failed: <status>` shape that
 * `isTerminalRefreshFailure` parses.
 */
export class TokenEndpointError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'TokenEndpointError';
  }
}

function tokenRequestBody(
  cfg: TokenClient,
  fields: Record<string, string>,
  extra?: Record<string, string>,
): { contentType: string; body: string } {
  const params: Record<string, string> = {
    client_id: cfg.clientId,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    ...fields,
    ...(extra ?? {}),
  };
  return cfg.bodyEncoding === 'json'
    ? { contentType: 'application/json', body: JSON.stringify(params) }
    : { contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams(params).toString() };
}

/** The ONE fetch to a token endpoint, for every grant type. */
async function requestTokens(
  cfg: TokenClient,
  fields: Record<string, string>,
  extra: Record<string, string> | undefined,
  label: 'exchange' | 'refresh',
): Promise<TokenResponse> {
  const { contentType, body } = tokenRequestBody(cfg, fields, extra);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new TokenEndpointError(`Token ${label} failed: ${res.status}`, res.status, text);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) {
    throw new TokenEndpointError(
      label === 'exchange' ? 'No access_token in response' : 'No access_token in refresh response',
      res.status,
      '',
    );
  }
  return data;
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
  return requestTokens(cfg, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' }, extra, 'exchange');
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
  return requestTokens(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' }, extra, 'refresh');
}
