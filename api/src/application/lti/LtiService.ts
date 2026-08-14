/**
 * LTI 1.3 / LTI Advantage — the application layer.
 *
 * The claim rules are pure and live in `domain/lti/ltiClaims.ts`. This module owns the
 * things that touch the world: verifying a launch signature against the platform's
 * JWKS, minting the signed client assertion that buys an access token, pushing a mark
 * back through AGS, and pulling a roster through NRPS.
 *
 * ── WHY NO DEPENDENCY ────────────────────────────────────────────────────────────
 * LTI 1.3 is OIDC plus two REST services. Signatures are RS256, which WebCrypto does
 * natively — the same shape `application/ide/githubOidc.ts` already uses to verify
 * GitHub's OIDC tokens. A JOSE library would add bundle weight to a Worker for
 * primitives the runtime already has.
 *
 * ── THE FIVE CHECKS THAT MATTER ──────────────────────────────────────────────────
 * A launch is a bearer of identity and marks, so verification is deliberately strict
 * and ordered, and every failure names what failed:
 *   1. signature — RS256 against the platform's published JWKS, by `kid`
 *   2. issuer    — matches the registration, exactly
 *   3. audience  — contains OUR client_id, so another tool's token cannot be replayed
 *   4. nonce     — matches the one we minted, and is BURNED on use (replay)
 *   5. expiry    — with 60s leeway for clock skew, as elsewhere on the platform
 *
 * Skipping 4 is the classic LTI vulnerability: without a burned nonce, a captured
 * id_token replays for its whole lifetime and grants the captor the launching user's
 * identity — which, for an instructor launch, is the ability to read a cohort and
 * write marks.
 */

import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  AGS_SCOPE, NRPS_SCOPE, agsScoreBody, readLaunchClaims, readMembers, rosterFromMembers,
  type AgsScore, type CohortRosterRow, type LtiLaunchContext, type LtiMember,
} from '../../domain/lti/ltiClaims';
import type { Env } from '../../env';

export type { LtiLaunchContext, LtiMember, CohortRosterRow, AgsScore };
export { AGS_SCOPE, NRPS_SCOPE, rosterFromMembers };

/**
 * One platform registration.
 *
 * `(issuer, clientId, deploymentId)` is the identity — all three, because one platform
 * (one issuer) hosts many tenants' deployments, and a registration matched on issuer
 * alone would let one institution's Moodle launch into another's boards.
 */
export interface LtiRegistration {
  issuer: string;
  clientId: string;
  deploymentIds: readonly string[];
  /** OIDC authorization endpoint — where the login response redirects. */
  authLoginUrl: string;
  /** OAuth2 token endpoint, for the client-credentials exchange. */
  accessTokenUrl: string;
  /** The platform's JWKS, for verifying launch signatures. */
  keySetUrl: string;
  /** Our signing key id, published on our own JWKS. */
  toolKeyId: string;
  /** Our RSA private key, PKCS#8 JWK. Never logged, never returned by a read path. */
  toolPrivateKeyJwk: JsonWebKey;
  /** The tenant this registration belongs to. */
  tenantId: number;
}

const JWKS_TTL_SECONDS = 3_600;
const NONCE_TTL_SECONDS = 600;
const CLOCK_LEEWAY_SECONDS = 60;
const REGISTRATIONS_TTL_SECONDS = 300;

const jwksCacheKey = (url: string) => `lti:jwks:${url}`;
const nonceKey = (issuer: string, nonce: string) => `lti:nonce:${issuer}:${nonce}`;

// ---------------------------------------------------------------------------
// Where registrations come from
// ---------------------------------------------------------------------------

/**
 * Registrations, from the `LTI_REGISTRATIONS` secret.
 *
 * A secret rather than a table, deliberately and for now: a registration contains an
 * RSA PRIVATE KEY, and the platform's generic entity layer serves every table it knows
 * about through one reader. `entityDefinition.ts` redacts on column-name patterns, and
 * betting a signing key on a regex matching `tool_private_key_jwk` is a bet this
 * subsystem should not make. Secrets are write-only in the deployment (see the
 * Cloudflare account-split note), which is the property a signing key needs.
 *
 * Parsing lives here rather than in the route because the storage a registration comes
 * from is exactly what the route must not know — swapping the secret for a table later
 * is then one function's business.
 */
export async function loadRegistrations(env: Env): Promise<readonly LtiRegistration[]> {
  return getOrSetCached<readonly LtiRegistration[]>(env, 'lti:registrations', async () => {
    const raw = (env as unknown as { LTI_REGISTRATIONS?: string }).LTI_REGISTRATIONS;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as LtiRegistration[] : [];
    } catch {
      return [];
    }
  }, { kvTtlSeconds: REGISTRATIONS_TTL_SECONDS });
}

/**
 * The registration a launch or service call belongs to, or null.
 *
 * `clientId` is optional because the OIDC initiation may omit it, but when the platform
 * does send one it must match: one issuer can host many tools.
 */
export async function registrationFor(
  env: Env,
  issuer: string,
  clientId: string | null,
): Promise<LtiRegistration | null> {
  const all = await loadRegistrations(env);
  return all.find((entry) => entry.issuer === issuer && (!clientId || entry.clientId === clientId)) ?? null;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeSegment = (value: unknown): string =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>;
}

/** Cryptographically random, URL-safe. Used for both `state` and `nonce`. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

// ---------------------------------------------------------------------------
// Launch verification
// ---------------------------------------------------------------------------

interface Jwks { keys: Array<JsonWebKey & { kid?: string; alg?: string }> }

async function fetchJwks(env: Env, url: string, force: boolean): Promise<Jwks | null> {
  if (force) await invalidateCached(env, jwksCacheKey(url));
  return getOrSetCached<Jwks | null>(env, jwksCacheKey(url), async () => {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const body = await response.json() as Jwks;
    return Array.isArray(body?.keys) ? { keys: body.keys.slice(0, 20) } : null;
  }, { kvTtlSeconds: JWKS_TTL_SECONDS });
}

async function verifyRs256(key: JsonWebKey, signingInput: string, signature: Uint8Array): Promise<boolean> {
  const imported = await crypto.subtle.importKey(
    'jwk',
    { ...key, alg: 'RS256', ext: true, key_ops: ['verify'] },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, signature as BufferSource, new TextEncoder().encode(signingInput));
}

export type LaunchResult =
  | { ok: true; context: LtiLaunchContext }
  | { ok: false; error: string };

/**
 * Verify an `id_token` from a platform and read its claims.
 *
 * `expectedNonce` comes from the login state we minted; passing null is only correct
 * for a re-verification of an already-consumed token and is never correct on a launch.
 */
export async function verifyLaunch(
  env: Env,
  idToken: string,
  registration: LtiRegistration,
  expectedNonce: string | null,
): Promise<LaunchResult> {
  const [headerSeg, payloadSeg, signatureSeg] = idToken.split('.');
  if (!headerSeg || !payloadSeg || !signatureSeg) return { ok: false, error: 'Malformed id_token.' };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeSegment(headerSeg);
    payload = decodeSegment(payloadSeg);
  } catch {
    return { ok: false, error: 'id_token is not valid JSON.' };
  }

  if (header.alg !== 'RS256') {
    // An `alg` the caller controls is the algorithm-confusion attack; only RS256 is
    // accepted, and `none` is rejected here rather than by the absence of a key.
    return { ok: false, error: 'id_token must be signed with RS256.' };
  }

  if (payload.iss !== registration.issuer) {
    return { ok: false, error: 'id_token issuer does not match the registration.' };
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(registration.clientId)) {
    return { ok: false, error: 'id_token audience is not this tool.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  if (!exp || now > exp + CLOCK_LEEWAY_SECONDS) return { ok: false, error: 'id_token has expired.' };
  if (iat && now < iat - CLOCK_LEEWAY_SECONDS) return { ok: false, error: 'id_token is not yet valid.' };

  const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (expectedNonce !== null) {
    if (!nonce || nonce !== expectedNonce) return { ok: false, error: 'id_token nonce does not match the login request.' };
    // BURN IT. A nonce that survives its use is a replay window the length of the
    // token's lifetime — see the header.
    const burned = await consumeNonce(env, registration.issuer, nonce);
    if (!burned) return { ok: false, error: 'id_token nonce has already been used.' };
  }

  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) return { ok: false, error: 'id_token header has no key id.' };

  const signature = base64UrlToBytes(signatureSeg);
  const signingInput = `${headerSeg}.${payloadSeg}`;

  // Cached keys first, then one forced refresh — that covers a platform rotating to a
  // key newer than our cache without hammering their JWKS on every launch.
  let verified = false;
  for (const force of [false, true]) {
    const jwks = await fetchJwks(env, registration.keySetUrl, force).catch(() => null);
    const key = jwks?.keys.find((candidate) => candidate.kid === kid);
    if (!key) continue;
    verified = await verifyRs256(key, signingInput, signature).catch(() => false);
    if (verified) break;
  }
  if (!verified) return { ok: false, error: 'id_token signature is not valid.' };

  const claims = readLaunchClaims(payload);
  if (!claims.ok) return claims;

  if (!registration.deploymentIds.includes(claims.context.deploymentId)) {
    return { ok: false, error: 'Launch deployment is not registered for this tool.' };
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Login (OIDC third-party initiation)
// ---------------------------------------------------------------------------

export interface LoginRequest {
  iss: string;
  login_hint?: string;
  target_link_uri?: string;
  lti_message_hint?: string;
  client_id?: string;
  lti_deployment_id?: string;
}

export interface LoginRedirect {
  url: string;
  state: string;
  nonce: string;
}

/**
 * Build the authentication request a platform's login initiation redirects to.
 *
 * `response_mode=form_post` and `response_type=id_token` are the only combination LTI
 * 1.3 permits, and `prompt=none` is required — the platform has already authenticated
 * the user, and prompting again inside an LMS iframe is a blank screen with a blocked
 * third-party cookie behind it.
 */
export async function buildLoginRedirect(
  env: Env,
  registration: LtiRegistration,
  request: LoginRequest,
  redirectUri: string,
): Promise<LoginRedirect> {
  const state = randomToken();
  const nonce = randomToken();
  await issueNonce(env, registration.issuer, nonce);

  const url = new URL(registration.authLoginUrl);
  const params: Record<string, string> = {
    scope: 'openid',
    response_type: 'id_token',
    response_mode: 'form_post',
    prompt: 'none',
    client_id: registration.clientId,
    redirect_uri: redirectUri,
    state,
    nonce,
    ...(request.login_hint ? { login_hint: request.login_hint } : {}),
    ...(request.lti_message_hint ? { lti_message_hint: request.lti_message_hint } : {}),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url: url.toString(), state, nonce };
}

/**
 * Nonce bookkeeping, on the read-through cache.
 *
 * A nonce is one-shot state, not a cached read, so the read-through helper is used
 * against its grain deliberately and carefully: `issueNonce` writes the marker through
 * the loader, and `consumeNonce` reads it and then INVALIDATES on both paths. The
 * miss-path invalidation is the load-bearing line — without it, the loader's "absent"
 * marker would itself be cached, and a nonce issued a moment later under the same key
 * would read as already-used.
 */
async function issueNonce(env: Env, issuer: string, nonce: string): Promise<void> {
  await getOrSetCached(env, nonceKey(issuer, nonce), async () => ISSUED, { kvTtlSeconds: NONCE_TTL_SECONDS });
}

const ISSUED = 'issued';
const ABSENT = 'absent';

/** True when the nonce existed and is now burned. False on a replay or an unknown one. */
async function consumeNonce(env: Env, issuer: string, nonce: string): Promise<boolean> {
  const key = nonceKey(issuer, nonce);
  const existing = await getOrSetCached<string>(env, key, async () => ABSENT, { kvTtlSeconds: NONCE_TTL_SECONDS });
  await invalidateCached(env, key);
  return existing === ISSUED;
}

// ---------------------------------------------------------------------------
// Service access tokens (client credentials, signed assertion)
// ---------------------------------------------------------------------------

async function signClientAssertion(registration: LtiRegistration, audience: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    registration.toolPrivateKeyJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: registration.toolKeyId };
  const payload = {
    iss: registration.clientId,
    sub: registration.clientId,
    aud: audience,
    iat: now,
    exp: now + 300,
    jti: randomToken(16),
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Exchange a signed assertion for a service access token.
 *
 * Cached for slightly less than its own lifetime and keyed by the SCOPE SET as well as
 * the registration: a token minted for `score` is not valid for
 * `contextmembership.readonly`, and a cache keyed on the registration alone would hand
 * a roster read a grade-only token and fail every launch after the first.
 */
export async function serviceAccessToken(
  env: Env,
  registration: LtiRegistration,
  scopes: readonly string[],
): Promise<string | null> {
  const scope = [...scopes].sort().join(' ');
  const cacheKey = `lti:token:${registration.issuer}:${registration.clientId}:${scope}`;
  return getOrSetCached<string | null>(env, cacheKey, async () => {
    const assertion = await signClientAssertion(registration, registration.accessTokenUrl);
    const response = await fetch(registration.accessTokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope,
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { access_token?: string };
    return typeof body.access_token === 'string' ? body.access_token : null;
    // 40 minutes: platforms issue these for an hour, and expiring ours first means a
    // stale token is never presented — a 401 mid-marking-run is far more expensive
    // than one extra token exchange.
  }, { kvTtlSeconds: 2_400 });
}

// ---------------------------------------------------------------------------
// AGS — marks going back
// ---------------------------------------------------------------------------

export type AgsResult = { ok: true } | { ok: false; error: string };

/**
 * Push one mark to the platform's gradebook.
 *
 * The score goes to the line item's `/scores` sub-resource, which is a PATH suffix and
 * not a query parameter — but a line item URL frequently ARRIVES with a query string
 * (Canvas appends `?type_id=`), so the suffix is inserted before the query rather than
 * appended to the whole URL. Getting that wrong produces a 404 the platform reports as
 * "line item not found", which reads like a configuration problem and is not one.
 */
export async function pushScore(
  env: Env,
  registration: LtiRegistration,
  lineItemUrl: string,
  score: AgsScore,
): Promise<AgsResult> {
  const token = await serviceAccessToken(env, registration, [AGS_SCOPE.score]);
  if (!token) return { ok: false, error: 'Could not obtain a grade-service token.' };

  const url = new URL(lineItemUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/scores`;

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/vnd.ims.lis.v1.score+json',
    },
    body: JSON.stringify(agsScoreBody(score)),
  });
  if (!response.ok) {
    return { ok: false, error: `Grade service rejected the score (${response.status}).` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// NRPS — the roster coming in
// ---------------------------------------------------------------------------

export type RosterResult =
  | { ok: true; members: readonly LtiMember[] }
  | { ok: false; error: string };

/**
 * Read the course roster.
 *
 * NRPS pages with an RFC 5988 `Link: <...>; rel="next"` header rather than a cursor in
 * the body. A reader that ignores it silently returns the first page — which for a
 * 300-student cohort is a roster that looks complete and is missing two hundred people,
 * the exact failure the canvas's own roster context budget exists to avoid.
 */
export async function fetchRoster(
  env: Env,
  registration: LtiRegistration,
  membershipsUrl: string,
): Promise<RosterResult> {
  const token = await serviceAccessToken(env, registration, [NRPS_SCOPE]);
  if (!token) return { ok: false, error: 'Could not obtain a roster-service token.' };

  const members: LtiMember[] = [];
  let next: string | null = membershipsUrl;
  // Bounded: ten pages at the platform default of 100+ is 1,000+ people, and an
  // unbounded follow of a `next` link is a loop a misbehaving platform controls.
  for (let page = 0; page < 10 && next; page += 1) {
    const response: Response = await fetch(next, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
      },
    });
    if (!response.ok) {
      return { ok: false, error: `Roster service returned ${response.status}.` };
    }
    const body = await response.json() as Record<string, unknown>;
    members.push(...readMembers(body));
    next = nextLink(response.headers.get('link'));
  }
  return { ok: true, members };
}

/** Parse `<url>; rel="next"` out of a Link header, ignoring the other relations. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part.trim());
    if (match) return match[1] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Our own JWKS — what the platform verifies our client assertion against
// ---------------------------------------------------------------------------

/**
 * The tool's public JWKS.
 *
 * Derived from the private key by dropping the private members rather than stored
 * separately, so the published key and the signing key cannot drift — a mismatch there
 * produces "invalid_client" from the platform with no further detail, which is among
 * the least debuggable errors in the protocol.
 */
export function toolPublicJwks(registrations: readonly LtiRegistration[]): { keys: JsonWebKey[] } {
  const seen = new Set<string>();
  const keys: JsonWebKey[] = [];
  for (const registration of registrations) {
    if (seen.has(registration.toolKeyId)) continue;
    seen.add(registration.toolKeyId);
    const { d, p, q, dp, dq, qi, ...pub } = registration.toolPrivateKeyJwk as unknown as Record<string, unknown>;
    void d; void p; void q; void dp; void dq; void qi;
    keys.push({ ...pub, kid: registration.toolKeyId, alg: 'RS256', use: 'sig' } as unknown as JsonWebKey);
  }
  return { keys };
}
