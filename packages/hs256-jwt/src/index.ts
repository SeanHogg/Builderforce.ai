/**
 * HS256 JWTs over Web Crypto — sign, verify, decode — written ONCE.
 *
 * The API's `JwtService` and the legacy worker's `lib/auth.ts` each carried a
 * verifier. They were written to "mirror exactly", and they did not: the worker
 * copy checked `exp` only, so a token the API would refuse for `nbf` the worker
 * accepted. Two verifiers of the same secret is one too many; this is the one.
 *
 * Dependency-free by contract — `crypto.subtle`, `TextEncoder`, `atob`/`btoa`
 * are on the global in Workers, Node 18+ and vitest. It therefore carries its own
 * two base64url lines rather than importing the API's byte helpers: a package the
 * worker consumes cannot reach into `api/src`.
 *
 * What is deliberately NOT here: revocation. Whether a `jti` is still live is a
 * question for the session store that issued it; this module answers only "was
 * this token signed with `secret`, and is it inside its validity window".
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const textToBase64Url = (text: string): string => bytesToBase64Url(encoder.encode(text));
const base64UrlToText = (value: string): string => decoder.decode(base64UrlToBytes(value));

async function importKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Sign `claims` as a compact `header.body.signature` HS256 JWT. */
export async function signHs256(claims: Record<string, unknown>, secret: string): Promise<string> {
  const header = textToBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = textToBase64Url(JSON.stringify(claims));
  const input = `${header}.${body}`;
  const key = await importKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return `${input}.${bytesToBase64Url(sig)}`;
}

/** Why a token was refused. Each is a distinct condition a caller may report differently. */
export type Hs256Failure = 'malformed' | 'bad_signature' | 'expired' | 'not_yet_valid';

export type Hs256Verdict<T> = { ok: true; claims: T } | { ok: false; reason: Hs256Failure };

export interface Hs256VerifyOptions {
  /** Unix seconds; injected so tests need not freeze the clock. Default: now. */
  nowSeconds?: number;
}

/**
 * Verify signature, then `exp`, then `nbf` — and hand back the claims.
 *
 * The signature is checked BEFORE the body is parsed, which is the ordering that
 * matters: a verifier that reads claims first has already acted on attacker-
 * controlled JSON by the time it decides the token was forged.
 */
export async function verifyHs256<T extends { exp: number; nbf?: number }>(
  token: string,
  secret: string,
  options: Hs256VerifyOptions = {},
): Promise<Hs256Verdict<T>> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, sig] = parts as [string, string, string];
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlToBytes(sig);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const key = await importKey(secret, 'verify');
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${header}.${body}`));
  if (!valid) return { ok: false, reason: 'bad_signature' };

  let claims: T;
  try {
    claims = JSON.parse(base64UrlToText(body)) as T;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object' || typeof claims.exp !== 'number') return { ok: false, reason: 'malformed' };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.exp < now) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf > now) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, claims };
}

/** The UNVERIFIED payload. Throws on a token that is not three segments. Use only
 *  to read a claim you will verify by other means — a `jti` to revoke, an `iss`
 *  to pick a JWKS — never to decide anything. */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  return JSON.parse(base64UrlToText(parts[1]!)) as T;
}

/** {@link decodeJwtPayload} that answers `null` instead of throwing. */
export function tryDecodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    return decodeJwtPayload<T>(token);
  } catch {
    return null;
  }
}
