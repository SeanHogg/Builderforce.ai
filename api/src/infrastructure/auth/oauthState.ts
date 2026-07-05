/**
 * Shared OAuth primitives — HMAC-signed CSRF `state` (no DB round-trip) and the
 * authorization-code → token exchange. Used by BOTH the login/link OAuth flow
 * ({@link ../../presentation/routes/oauthRoutes}) and the calendar-connection
 * flow ({@link ../../presentation/routes/calendarRoutes}); keep it here so the
 * crypto lives in exactly one place.
 */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

/**
 * Sign an arbitrary state payload. A random `nonce` and issue timestamp `ts` are
 * stamped in automatically, so two calls with the same payload differ and the
 * verifier can enforce a freshness window.
 */
export async function signState(secret: string, payload: Record<string, unknown>): Promise<string> {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const body = JSON.stringify({ ...payload, nonce, ts: Date.now() });
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return btoa(body + '|' + toHex(new Uint8Array(sig)));
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
    const key = await hmacKey(secret, ['verify']);
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body));
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
 * Exchange an authorization code for tokens (RFC 6749 §4.1.3). Returns the raw
 * token set including `refresh_token`/`expires_in`/`scope` when the provider
 * supplies them.
 */
export async function exchangeCodeForTokens(
  cfg: { tokenUrl: string; clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
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
  cfg: { tokenUrl: string; clientId: string; clientSecret: string },
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error('No access_token in refresh response');
  return data;
}
