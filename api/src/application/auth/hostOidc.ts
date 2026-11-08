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
 *   - issuer + expiry + not-before are checked HERE, before any claim is
 *     trusted — the resolver never sees an unverified claim set.
 *
 * Deliberately NOT checked here: audience and `sub`. Audience pinning is the
 * host's to enforce on its own tokens (we are a relying party, not the
 * audience issuer); `sub` is the host user id and is not a BuilderForce user.
 * What we consume is the tenant/account/company coordinate triple.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseJws, verifyJwsWithJwks } from '../../infrastructure/auth/jws';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { tenants } from '../../infrastructure/database/schema';
import { eq } from 'drizzle-orm';

/** JWKS cache TTL. An enterprise host rotates rarely; an unknown `kid` forces a
 *  refresh regardless (inside the shared verifier), so this can be long. */
const JWKS_TTL_SECONDS = 3600;

/** The claims an inbound host token contributes to segment resolution. These are
 *  the only fields `resolveSegment` consumes; the rest of the host claim set
 *  (role/persona/plan, §2.1) is available to callers that need it. */
export interface HostOidcClaims {
  /** Host issuer — must equal the tenant's configured `idpIssuer`. */
  iss: string;
  /** External account id → resolver `acct`. */
  accountId: string;
  /** External company id → resolver `co`. */
  companyId: string;
}

export type HostOidcVerification =
  | { ok: true; claims: HostOidcClaims }
  | { ok: false; error: string };

/** Read the ONE issuer a segmented tenant trusts, or null for a direct tenant. */
async function idpIssuerOf(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db
    .select({ idpIssuer: tenants.idpIssuer })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.idpIssuer ?? null;
}

/**
 * Verify an inbound host OIDC token and return the claims that identify the
 * end-client Segment.
 *
 * Checks, in order: shape, presence of a configured IdP issuer for this tenant,
 * issuer match, expiry/not-before, then the RS256 signature against the
 * issuer's JWKS. Every failure returns a reason (the caller answers 401 and the
 * reason is the only diagnostic the host integration gets).
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

  const idpIssuer = await idpIssuerOf(db, tenantId);
  if (!idpIssuer) {
    return { ok: false, error: 'This workspace does not trust an external identity provider.' };
  }

  if (payload.iss !== idpIssuer) {
    return { ok: false, error: 'Token was not issued by the trusted identity provider.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : 0;
  // 60s leeway absorbs clock skew between the host and the edge.
  if (exp && now > exp + 60) return { ok: false, error: 'Token has expired.' };
  if (nbf && now < nbf - 60) return { ok: false, error: 'Token is not yet valid.' };

  const signature = await verifyJwsWithJwks(env, {
    url: `${idpIssuer}/.well-known/jwks`,
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

  return { ok: true, claims: { iss: idpIssuer, accountId, companyId } };
}

/**
 * The single live entry that turns a VERIFIED inbound host JWT into a Segment
 * id (PRD 05 §2.1: "BuilderForce verifies … then `resolveSegment()`").
 *
 * This is the relying-party counterpart to the session middleware: that path
 * resolves claims OUR JwtService minted; this path resolves claims an external
 * IdP signed. Both converge on the same `resolveSegment` chokepoint, so the
 * no-bleed guarantee (§2.2) holds for host tokens exactly as for our own.
 */
export async function resolveSegmentFromHostToken(
  env: Env,
  db: Db,
  tenantId: number,
  token: string,
): Promise<
  | { ok: true; segmentId: string; claims: HostOidcClaims }
  | { ok: false; error: string }
> {
  const verified = await verifyHostOidcToken(env, db, tenantId, token);
  if (!verified.ok) return verified;

  const segmentId = await resolveSegment(db, tenantId, {
    accountId: verified.claims.accountId,
    companyId: verified.claims.companyId,
  }, env);
  return { ok: true, segmentId, claims: verified.claims };
}
