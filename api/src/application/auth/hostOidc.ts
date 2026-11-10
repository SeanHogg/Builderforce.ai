/**
 * Inbound host OIDC verification — the live claims caller for `resolveSegment`.
 *
 * PRD 05 §2.1: a 'segmented' tenant's IdP is an external host (e.g. BurnRateOS).
 * The host signs a JWT asserting which end-client (account/company) the request
 * is for. Before this module existed, `resolveSegment()` could map `acct`/`co`
 * claims to a Segment, but NOTHING verified an inbound host token — the only
 * caller of `resolveSegment` was our own session middleware reading claims our
 * own `JwtService` had minted. There was no way for a host JWT's VERIFIED
 * claims to reach the resolver. This is that caller.
 *
 * Trust model (mirrors `githubOidc.ts`, same shared `verifyJwsWithJwks`):
 *   - the tenant row's `idpIssuer` is the ONE issuer we accept for that tenant
 *     (burnrateos → `https://app.burnrateos.com`). The JWKS is the issuer's
 *     standard discovery location, so no per-tenant key config is needed;
 *   - signature is RS256 against the issuer's published JWKS, with the
 *     cached-then-forced-refresh retry that rotation requires;
 *   - issuer + expiry + not-before + audience are checked HERE, before any claim
 *     is trusted — the resolver never sees an unverified claim set.
 *
 * Expiry is MANDATORY: a token with no numeric `exp` is rejected (spec 05 §2.1
 * lists `exp` in the claim set; a host token that never expires would be a
 * bearer credential for the segment forever). 60s leeway absorbs clock skew.
 *
 * Audience: the expected audience is configured per tenant beside `idpIssuer`,
 * in the tenant's settings JSON as `tenants.settings.idpAudience` (a string; no
 * schema migration — the settings column is the tenant's config source). When it
 * is configured the token's `aud` (string, or array of strings) MUST contain it;
 * when it is not configured, audience is not pinned (the issuer + signature are
 * then the whole trust). Configure it for every production host so a token the
 * host minted for another relying party cannot be replayed here.
 *
 * Shared issuers: `tenants.idp_issuer` is not unique and the token's tenant is
 * chosen by the caller's `x-builderforce-workspace` header, so if two tenants
 * trust the same issuer, a token minted for one would replay against the other.
 * Rule: when the tenant's issuer is ALSO trusted by any other tenant, an
 * `idpAudience` MUST be configured for it (per-tenant audiences are what bind a
 * token to one workspace); without one every token is rejected with a clear
 * configuration error. A sole-trusting tenant may still leave audience unset.
 *
 * Scopes (the rule `serviceTokenAuth.ts` enforces): a host token is an END-USER
 * token for ONE segment. It is granted `HOST_OIDC_BASELINE_SCOPES`
 * (`ingest:feedback` — the embedded feedback widget) by default. Any other seam
 * scope — notably `segments:manage` and `webhooks:manage` — is granted ONLY when
 * the verified token's `scope` (space-delimited) or `scp` (array or string) claim
 * names it explicitly, and only scopes in `HOST_OIDC_CLAIMABLE_SCOPES` can be
 * claimed at all. Scope is checked BEFORE `resolveSegment` runs, so a refused
 * request never lazily creates a segment.
 *
 * `sub` is the host user id and is not a BuilderForce user; it is not consumed.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseJws, verifyJwsWithJwks } from '../../infrastructure/auth/jws';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { tenants } from '../../infrastructure/database/schema';
import { and, eq, ne } from 'drizzle-orm';
import type { TenantApiScope } from '../llm/tenantApiKeyService';

/** JWKS cache TTL. An enterprise host rotates rarely; an unknown `kid` forces a
 *  refresh regardless (inside the shared verifier), so this can be long. */
const JWKS_TTL_SECONDS = 3600;

/** Clock-skew leeway for exp/nbf. */
const CLOCK_LEEWAY_SECONDS = 60;

/** Granted to every verified host token without any scope claim. */
export const HOST_OIDC_BASELINE_SCOPES: readonly TenantApiScope[] = ['ingest:feedback'];

/** The only scopes a host token's `scope`/`scp` claim can grant (the seam scopes). */
export const HOST_OIDC_CLAIMABLE_SCOPES: readonly TenantApiScope[] = [
  'ingest:feedback',
  'webhooks:manage',
  'segments:manage',
];

/** The claims an inbound host token contributes to segment resolution. */
export interface HostOidcClaims {
  /** Host issuer — must equal the tenant's configured `idpIssuer`. */
  iss: string;
  /** External account id → resolver `acct`. */
  accountId: string;
  /** External company id → resolver `co`. */
  companyId: string;
  /** Seam scopes the token explicitly claims (filtered to HOST_OIDC_CLAIMABLE_SCOPES). */
  scopes: TenantApiScope[];
}

export type HostOidcVerification =
  | { ok: true; claims: HostOidcClaims }
  | { ok: false; error: string };

interface HostTrust {
  issuer: string;
  audience: string | null;
}

/** Read the expected audience from the tenant's settings JSON (null when unset). */
function idpAudienceFrom(settings: string | null | undefined): string | null | 'unreadable' {
  if (!settings) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(settings);
  } catch {
    // Not silent: the caller rejects the token with a configuration error.
    return 'unreadable';
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const audience = (parsed as { idpAudience?: unknown }).idpAudience;
  return typeof audience === 'string' && audience.trim() ? audience.trim() : null;
}

/** Read what a segmented tenant trusts (issuer + optional audience), or null for a direct tenant. */
async function hostTrustOf(db: Db, tenantId: number): Promise<HostTrust | null | 'unreadable'> {
  const [row] = await db
    .select({ idpIssuer: tenants.idpIssuer, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row?.idpIssuer) return null;
  const audience = idpAudienceFrom(row.settings);
  if (audience === 'unreadable') return 'unreadable';
  return { issuer: row.idpIssuer, audience };
}

/** Does any OTHER tenant trust the same issuer? (`tenants.idp_issuer` is not unique.) */
async function issuerSharedWithAnotherTenant(db: Db, tenantId: number, issuer: string): Promise<boolean> {
  const [other] = await db
    .select({ otherTenantId: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.idpIssuer, issuer), ne(tenants.id, tenantId)))
    .limit(1);
  return Boolean(other);
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.some((a) => a === expected);
  return false;
}

/** The explicit seam scopes a verified payload claims via `scope` or `scp`. */
function claimedScopes(payload: Record<string, unknown>): TenantApiScope[] {
  const raw: unknown[] = [];
  for (const claim of [payload.scope, payload.scp]) {
    if (typeof claim === 'string') raw.push(...claim.split(/\s+/));
    else if (Array.isArray(claim)) raw.push(...claim);
  }
  const claimable = HOST_OIDC_CLAIMABLE_SCOPES as readonly unknown[];
  return [...new Set(raw.filter((s): s is TenantApiScope => claimable.includes(s)))];
}

/** Does a verified host token's claim set grant `required`? (see the header rule) */
export function hostTokenGrantsScope(claims: Pick<HostOidcClaims, 'scopes'>, required: TenantApiScope): boolean {
  return HOST_OIDC_BASELINE_SCOPES.includes(required) || claims.scopes.includes(required);
}

/**
 * Verify an inbound host OIDC token and return the claims that identify the
 * end-client Segment.
 *
 * Checks, in order: shape, presence of a configured IdP issuer for this tenant,
 * issuer match, mandatory expiry / not-before, audience (when configured), then
 * the RS256 signature against the issuer's JWKS. Every failure returns a reason
 * (the caller answers 401 and the reason is the only diagnostic the host gets).
 */
export async function verifyHostOidcToken(
  env: Env,
  db: Db,
  tenantId: number,
  token: string,
): Promise<HostOidcVerification> {
  const parsed = parseJws(token);
  if (!parsed) return { ok: false, error: 'Malformed token.' };
  const { payload } = parsed;

  const trust = await hostTrustOf(db, tenantId);
  if (trust === 'unreadable') {
    return { ok: false, error: 'This workspace identity provider settings are unreadable.' };
  }
  if (!trust) {
    return { ok: false, error: 'This workspace does not trust an external identity provider.' };
  }

  if (payload.iss !== trust.issuer) {
    return { ok: false, error: 'Token was not issued by the trusted identity provider.' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number') return { ok: false, error: 'Token has no expiry.' };
  if (now > payload.exp + CLOCK_LEEWAY_SECONDS) return { ok: false, error: 'Token has expired.' };
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : 0;
  if (nbf && now < nbf - CLOCK_LEEWAY_SECONDS) return { ok: false, error: 'Token is not yet valid.' };

  if (trust.audience && !audienceMatches(payload.aud, trust.audience)) {
    return { ok: false, error: 'Token was not issued for this audience.' };
  }
  if (!trust.audience && await issuerSharedWithAnotherTenant(db, tenantId, trust.issuer)) {
    return {
      ok: false,
      error: 'This identity provider is trusted by more than one workspace; configure idpAudience for this workspace.',
    };
  }

  const signature = await verifyJwsWithJwks(env, {
    url: `${trust.issuer}/.well-known/jwks`,
    cacheKey: `host-oidc:jwks:${tenantId}`,
    ttlSeconds: JWKS_TTL_SECONDS,
  }, parsed);
  if (!signature.ok) return { ok: false, error: signature.error };

  const accountId = typeof payload.acct === 'string' ? payload.acct
    : (typeof payload.accountId === 'string' ? payload.accountId : '');
  const companyId = typeof payload.co === 'string' ? payload.co
    : (typeof payload.companyId === 'string' ? payload.companyId : '');
  if (!accountId || !companyId) {
    return { ok: false, error: 'Token carries no account/company claims.' };
  }

  return { ok: true, claims: { iss: trust.issuer, accountId, companyId, scopes: claimedScopes(payload) } };
}

/**
 * The single live entry that turns a VERIFIED inbound host JWT into a Segment
 * id (PRD 05 §2.1: "BuilderForce verifies … then `resolveSegment()`"), for a
 * request that needs `requiredScope`.
 *
 * Verification failure → 401; a verified token that is not granted the scope →
 * 403, decided BEFORE `resolveSegment` runs (no lazy-create on a refusal). Both
 * this path and the session middleware converge on the same `resolveSegment`
 * chokepoint, so the no-bleed guarantee (§2.2) holds for host tokens too.
 */
export async function resolveSegmentFromHostToken(
  env: Env,
  db: Db,
  tenantId: number,
  token: string,
  requiredScope: TenantApiScope,
): Promise<
  | { ok: true; segmentId: string; claims: HostOidcClaims }
  | { ok: false; status: 401 | 403; error: string }
> {
  const verified = await verifyHostOidcToken(env, db, tenantId, token);
  if (!verified.ok) return { ok: false, status: 401, error: verified.error };

  if (!hostTokenGrantsScope(verified.claims, requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: `This identity token is not authorized for the '${requiredScope}' scope.`,
    };
  }

  const segmentId = await resolveSegment(db, tenantId, {
    accountId: verified.claims.accountId,
    companyId: verified.claims.companyId,
  }, env);
  return { ok: true, segmentId, claims: verified.claims };
}
