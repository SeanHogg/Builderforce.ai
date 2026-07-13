/**
 * Guest chat token — a signed, short-lived credential a LOGGED-OUT visitor sends
 * to reach the Brain gateway before they have an account.
 *
 * It is deliberately NOT a tenant JWT. A guest has no tenant, and we never want
 * the tenant-JWT verifier (`requireTenantAccess` — a security-critical surface
 * whose whole contract is "a valid token resolves to a real tenantId") to grow a
 * tid-less anonymous branch. So guest auth is a separate, self-contained scheme:
 *
 *   Format:  bfguest_<b64url(payload)>.<b64url(hmac-sha256)>
 *   Payload: { vid: <visitorId>, exp: <unix seconds> }
 *
 * The `bfguest_` prefix lets the gateway detect a guest token and route it to the
 * guest handler before it ever touches the tenant auth path. Signed with
 * HMAC-SHA-256 under JWT_SECRET (same key material, distinct token shape), so a
 * guest token can never be replayed as a tenant token and vice-versa.
 */

export const GUEST_TOKEN_PREFIX = 'bfguest_';

interface GuestTokenPayload {
  /** Anonymous visitor id (the marketing-session key). */
  vid: string;
  /** Expiry, unix seconds. */
  exp: number;
}

function b64urlEncodeBytes(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlEncodeStr(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecodeStr(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('JWT_SECRET is not set — cannot sign/verify guest tokens.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Mint a signed guest token for `visitorId`, valid for `expiresInSeconds`. */
export async function signGuestToken(
  visitorId: string,
  secret: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: GuestTokenPayload = { vid: visitorId, exp: now + expiresInSeconds };
  const body = b64urlEncodeStr(JSON.stringify(payload));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${GUEST_TOKEN_PREFIX}${body}.${b64urlEncodeBytes(sig)}`;
}

/**
 * Verify a guest token: constant-shape parse, HMAC check, expiry check. Returns
 * the visitorId on success, or null on ANY failure (bad prefix/shape, bad
 * signature, expired). Never throws — the gateway treats null as "not a valid
 * guest" and returns 401.
 */
export async function verifyGuestToken(token: string, secret: string): Promise<string | null> {
  if (!token.startsWith(GUEST_TOKEN_PREFIX)) return null;
  const rest = token.slice(GUEST_TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return null;
  const body = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);
  try {
    const key = await importKey(secret);
    const sigBytes = Uint8Array.from(b64urlDecodeStr(sigB64), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(b64urlDecodeStr(body)) as GuestTokenPayload;
    if (typeof payload.vid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.vid;
  } catch {
    return null;
  }
}

/** True unless the guest Brain has been explicitly disabled via the kill switch. */
export function guestBrainEnabled(env: { GUEST_BRAIN_ENABLED?: string }): boolean {
  return env.GUEST_BRAIN_ENABLED !== 'false';
}
