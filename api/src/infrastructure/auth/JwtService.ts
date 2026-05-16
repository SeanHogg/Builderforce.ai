import { TenantRole } from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub:  string;       // userId
  tid:  number;       // tenantId
  role: TenantRole;
  /** true when the underlying user has `isSuperadmin = true`. Mirrors the
   *  `sa` claim on WebJwtPayload so gateway routes can bypass plan caps and
   *  strict-pin gates for platform admins. Never set on impersonation tokens —
   *  impersonation deliberately drops superadmin privileges to preserve audit. */
  sa?:  boolean;
  sv?:  number;       // session_version — for fast force-logout without a blocklist
  jti?: string;
  sid?: string;
  iat:  number;
  exp:  number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64urlEncode(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function strToB64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlToStr(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error(
      'JWT_SECRET is not set. Set it with: wrangler secret put JWT_SECRET (in the api/ directory), or add JWT_SECRET to api/.env and run npm run secrets:from-env'
    );
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Signs a JWT using HMAC-SHA-256 via the Web Crypto API.
 * Compatible with Cloudflare Workers (no Node.js required).
 */
export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    ...payload,
    jti: payload.jti ?? crypto.randomUUID(),
    sid: payload.sid,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = strToB64url(JSON.stringify(full));
  const input  = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));

  return `${input}.${b64urlEncode(sig)}`;
}

/**
 * Verifies and decodes a JWT.
 * Throws if the signature is invalid or the token is expired.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const header = parts[0]!;
  const body   = parts[1]!;
  const sig    = parts[2]!;
  const input = `${header}.${body}`;

  const key = await importKey(secret);
  const sigBytes = Uint8Array.from(
    atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(input),
  );
  if (!valid) throw new Error('Invalid token signature');

  const payload: JwtPayload = JSON.parse(b64urlToStr(body));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');

  return payload;
}

// ---------------------------------------------------------------------------
// Web / Marketplace JWT  (no tenant / role required)
// ---------------------------------------------------------------------------

export interface WebJwtPayload {
  sub:      string;   // userId
  email:    string;
  username: string;
  sa?:      boolean;  // true only for superadmins
  jti?:     string;
  sid?:     string;
  mfa?:     boolean;
  mfaPending?: boolean;
  amr?:     string[];
  iat:      number;
  exp:      number;
}

export async function signWebJwt(
  payload:          Omit<WebJwtPayload, 'iat' | 'exp'>,
  secret:           string,
  expiresInSeconds: number = 86_400, // 24 hours for web sessions
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: WebJwtPayload = {
    ...payload,
    jti: payload.jti ?? crypto.randomUUID(),
    sid: payload.sid ?? (payload.mfaPending ? undefined : crypto.randomUUID()),
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = strToB64url(JSON.stringify(full));
  const input  = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));

  return `${input}.${b64urlEncode(sig)}`;
}

export async function verifyWebJwt(token: string, secret: string): Promise<WebJwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [header, body, sig] = parts as [string, string, string];
  const input = `${header}.${body}`;

  const key = await importKey(secret);
  const sigBytes = Uint8Array.from(
    atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(input));
  if (!valid) throw new Error('Invalid token signature');

  const payload: WebJwtPayload = JSON.parse(b64urlToStr(body));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');

  return payload;
}

export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  return JSON.parse(b64urlToStr(parts[1]!)) as T;
}

// ---------------------------------------------------------------------------
// Emulation JWT  (Super Admin impersonation)
// ---------------------------------------------------------------------------

/**
 * Extended payload for Super Admin impersonation tokens.
 * Carries the standard tenant fields plus emulation metadata.
 * `emu_readonly: true` causes API middleware to reject all mutating verbs.
 */
export interface EmulationJwtPayload extends JwtPayload {
  emu:         true;
  emu_by:      string;  // superadmin userId who started the session
  emu_sid:     string;  // adminImpersonationSessions.id
  emu_readonly: true;
}

/**
 * Signs a 1-hour, read-only emulation token for a target user/tenant/role.
 * The resulting JWT must travel via `X-Emulation-Token`; it is rejected by
 * all `/api/admin/*` routes and all mutating verbs.
 */
export async function signEmulationJwt(
  payload: {
    sub:     string;   // target userId
    tid:     number;   // tenantId
    role:    TenantRole;
    emuBy:   string;   // superadmin userId
    emuSid:  string;   // impersonation session id
  },
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const full: EmulationJwtPayload = {
    sub:          payload.sub,
    tid:          payload.tid,
    role:         payload.role,
    emu:          true,
    emu_by:       payload.emuBy,
    emu_sid:      payload.emuSid,
    emu_readonly: true,
    jti,
    iat:          now,
    exp:          now + 3600,  // 1 hour, non-renewable
  };

  const header = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = strToB64url(JSON.stringify(full));
  const input  = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));

  return `${input}.${b64urlEncode(sig)}`;
}

/**
 * Verifies and decodes an emulation JWT.
 * Throws if invalid, expired, or not an emulation token.
 */
export async function verifyEmulationJwt(
  token: string,
  secret: string,
): Promise<EmulationJwtPayload> {
  const payload = await verifyJwt(token, secret) as EmulationJwtPayload;
  if (!payload.emu) throw new Error('Not an emulation token');
  return payload;
}
