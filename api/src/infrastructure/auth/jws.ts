/**
 * ONE RS256 JWS verifier, and the base64url primitives under it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Three subsystems verify an RS256 JWT against a publisher's JWKS, and all three
 * had written the same four functions: base64url decoding, segment parsing,
 * `crypto.subtle.importKey` + `verify`, and the cached-then-forced-refresh JWKS
 * fetch that handles a publisher rotating to a key newer than our cache.
 *
 *   · `application/ide/githubOidc.ts`  — GitHub Actions OIDC, for deploys
 *   · `application/lti/LtiService.ts`  — LTI 1.3 launches, for identity and marks
 *   · `application/auth/enterpriseSso.ts` — institutional SSO, for sign-in
 *
 * Three copies of a signature check is three places a subtle mistake can live,
 * and the mistakes here are not subtle in consequence: each of these is an
 * authentication boundary. The forced-refresh retry in particular is the kind of
 * detail one copy acquires and the others do not — one of the three would have
 * started failing every login the day its IdP rotated a key.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 * Claim validation. Issuer, audience, expiry, nonce and role rules differ per
 * protocol and belong to the subsystem that knows what they mean — LTI burns a
 * nonce, GitHub pins an audience, SSO matches an email domain. This module
 * answers exactly one question: was this token signed by a key the named JWKS
 * publishes? Folding the claim checks in here is how a caller ends up believing
 * a check ran that it did not ask for.
 */

import { getOrSetCached, invalidateCached } from '../cache/readThroughCache';
import type { Env } from '../../env';

export interface Jwks {
  keys: Array<JsonWebKey & { kid?: string; alg?: string }>;
}

/** A parsed compact JWS. `signingInput` is the exact bytes the signature covers,
 *  kept as the ORIGINAL text rather than re-serialised — re-encoding the header
 *  and payload would change whitespace and key order and break every signature. */
export interface ParsedJws {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JSON → one base64url JWS segment. Used when we are the SIGNER. */
export const encodeJwsSegment = (value: unknown): string =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

/** Cryptographically random, URL-safe. The platform's one source of `state`,
 *  `nonce` and `jti` values on this path. */
export function randomUrlToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

/** Split and decode a compact JWS, or null when it is not one. */
export function parseJws(token: string): ParsedJws | null {
  const [headerSeg, payloadSeg, signatureSeg] = token.split('.');
  if (!headerSeg || !payloadSeg || !signatureSeg) return null;
  try {
    const decode = (segment: string) =>
      JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>;
    return {
      header: decode(headerSeg),
      payload: decode(payloadSeg),
      signingInput: `${headerSeg}.${payloadSeg}`,
      signature: base64UrlToBytes(signatureSeg),
    };
  } catch {
    return null;
  }
}

/**
 * The payload of a token whose signature has NOT been checked.
 *
 * Exists because two callers legitimately need one claim before they can pick the
 * key to verify with — an LTI launch reads `iss` to select a registration, and an
 * SSO callback reads it to select a connection. Named so that every use of it
 * reads as the hazard it is at the call site.
 */
export function unverifiedPayload(token: string): Record<string, unknown> | null {
  return parseJws(token)?.payload ?? null;
}

async function verifyRs256(key: JsonWebKey, signingInput: string, signature: Uint8Array): Promise<boolean> {
  const imported = await crypto.subtle.importKey(
    'jwk',
    { ...key, alg: 'RS256', ext: true, key_ops: ['verify'] },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    imported,
    signature as BufferSource,
    new TextEncoder().encode(signingInput),
  );
}

export interface JwksSource {
  url: string;
  /** Cache namespace. Distinct per publisher so one IdP's rotation cannot evict
   *  another's keys, and so a shared URL is still cached once. */
  cacheKey: string;
  ttlSeconds?: number;
}

const DEFAULT_JWKS_TTL_SECONDS = 3_600;
/** A publisher that serves hundreds of keys is either misconfigured or hostile;
 *  either way we do not want to import all of them looking for a `kid`. */
const MAX_KEYS = 20;

async function fetchJwks(env: Env, source: JwksSource, force: boolean): Promise<Jwks | null> {
  if (force) await invalidateCached(env, source.cacheKey);
  return getOrSetCached<Jwks | null>(env, source.cacheKey, async () => {
    const response = await fetch(source.url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const body = await response.json() as Jwks;
    return Array.isArray(body?.keys) ? { keys: body.keys.slice(0, MAX_KEYS) } : null;
  }, { kvTtlSeconds: source.ttlSeconds ?? DEFAULT_JWKS_TTL_SECONDS });
}

export type JwsVerification =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Was this token signed by a key the named JWKS publishes?
 *
 * `alg` is checked HERE and only RS256 is accepted. An algorithm the token itself
 * chooses is the algorithm-confusion attack, and `none` has to be refused by an
 * explicit check rather than by the absence of a key — a verifier that reaches
 * "no key matched" for an unsigned token has already made the mistake once.
 *
 * Cached keys are tried first, then ONE forced refresh. That covers a publisher
 * rotating to a key newer than our cache without hammering their JWKS on every
 * request, and it is exactly the retry that was present in one of the three
 * hand-written copies this replaces and absent from the others.
 */
export async function verifyJwsWithJwks(
  env: Env,
  source: JwksSource,
  parsed: ParsedJws,
): Promise<JwsVerification> {
  if (parsed.header.alg !== 'RS256') {
    return { ok: false, error: 'Token must be signed with RS256.' };
  }
  const kid = typeof parsed.header.kid === 'string' ? parsed.header.kid : '';
  if (!kid) return { ok: false, error: 'Token header has no key id.' };

  for (const force of [false, true]) {
    const jwks = await fetchJwks(env, source, force).catch(() => null);
    const key = jwks?.keys.find((candidate) => candidate.kid === kid);
    if (!key) continue;
    const verified = await verifyRs256(key, parsed.signingInput, parsed.signature).catch(() => false);
    if (verified) return { ok: true };
  }
  return { ok: false, error: 'Token signature is not valid.' };
}
