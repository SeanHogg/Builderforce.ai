/**
 * INSTALL-SCOPED TOKENS — "this vendor, acting for that tenant" (PRD 24 §5.3).
 *
 * A vendor's integration server has two different things to say to us, and they
 * need two different credentials:
 *
 *   • "I am Acme Payroll"            → a `tenant_api_keys` row on the PUBLISHER's
 *                                      workspace, with `write:packages` /
 *                                      `read:installs`. Server-to-server, long
 *                                      lived, and it reaches nobody's data.
 *   • "I am Acme Payroll acting for  → this. Short lived, names ONE install, and
 *      the workspace that installed    carries exactly the scopes that install's
 *      me"                             admin approved.
 *
 * The PRD calls the second one OAuth, and what it actually needs from OAuth is the
 * two-party separation above — not a second consent screen. **The install IS the
 * grant.** A workspace admin already read the scope list and pressed Install; a
 * vendor asking that admin to approve the same scopes a second time, on a second
 * screen, is the extra step §2.4 says kills marketplace conversion. So the
 * exchange is client-credentials shaped: the publisher's key plus an install id
 * they were told about, for a token bounded by what that install already granted.
 *
 * ── WHY THERE IS NO TOKEN TABLE ─────────────────────────────────────────────
 * A stored token would be a fourth credential store, and it would be WORSE than
 * this one at the job that matters: revocation. The install row is consulted on
 * every single call anyway — it is where the granted scopes, the subscription
 * state and the disabled flag live — so a signed, five-minute, self-describing
 * token that is re-checked against that row is revoked the instant somebody
 * uninstalls, with no sweep, no TTL and no row to clean up. A stored token would
 * add a table and would still have to do the same read.
 *
 * ── WHAT THE TOKEN CAN AND CANNOT DO ────────────────────────────────────────
 * It authorises exactly the scopes on the install and nothing else, and every
 * consumer resolves it through {@link resolveInstallToken}, which re-reads the
 * install. Three things are therefore true by construction rather than by
 * remembering: an uninstalled extension's live token stops working immediately, a
 * narrowed grant narrows every token already issued, and a suspended publisher's
 * tokens all die at once.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  extensionPackages,
  extensionVersions,
  tenantExtensionInstalls,
  tenants,
} from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { signOpaqueJwt, verifyOpaqueJwt } from '../../infrastructure/auth/JwtService';
import { installGrants, subscriptionEntitles, type ExtensionScope } from './extensionContract';

/**
 * Five minutes.
 *
 * Long enough for a vendor to make the calls one webhook provoked; short enough
 * that a token leaked into a log is worthless before anybody reads the log. It is
 * deliberately NOT tunable by the vendor: the install is what bounds the
 * authority, and a longer token would only widen the window in which a revoked
 * install still worked.
 */
const TOKEN_TTL_SECONDS = 300;

/** The `typ` claim. Its whole job is to make one token type unusable as another. */
const TOKEN_TYPE = 'bf_ext_install';

interface InstallTokenClaims {
  typ: typeof TOKEN_TYPE;
  /** The install. The subject, and the only identity that reaches the vendor. */
  sub: string;
  /** The PUBLISHER's workspace — checked against the calling key's tenant. */
  pub: number;
  /** The package, so a token cannot be replayed against a sibling install. */
  pkg: string;
  scopes: string[];
  iat: number;
  exp: number;
}

export class InstallTokenError extends Error {
  constructor(message: string, public readonly status: 400 | 401 | 403 | 404 = 400) {
    super(message);
    this.name = 'InstallTokenError';
  }
}

/**
 * What a resolved token actually permits — everything a vendor-facing handler
 * needs and nothing it could be tempted to widen with.
 */
export interface ResolvedInstall {
  installId: string;
  /** The INSTALLING workspace. The tenant every downstream read must be scoped to. */
  tenantId: number;
  publisherTenantId: number;
  packageId: string;
  packageSlug: string;
  versionId: string;
  semver: string;
  grantedScopes: string[];
  planCode: string | null;
  subscriptionState: string;
  /**
   * The start of the metering window not yet billed.
   *
   * Carried on the resolved install because the usage endpoint needs it on every
   * single call — it is the floor a backdated report is clamped to — and this
   * read has already fetched the row. Deriving it separately would make a vendor
   * reporting per API call pay three extra queries per report for a value that
   * was sitting in the row we just read.
   */
  meteredSince: Date | null;
}

/**
 * One live install, read across tenants because the caller is the publisher and
 * the row belongs to the customer.
 *
 * `public_catalogue` is the right reason and not a fudge: what makes this row
 * readable by another workspace is that it is one end of a PUBLISHED artifact's
 * install, and the predicate below pins the other end to the publisher who owns
 * it. A caller who is not that publisher gets no row at all.
 */
async function loadInstallForPublisher(
  db: Db,
  installId: string,
  publisherTenantId: number,
): Promise<ResolvedInstall | null> {
  const [row] = await db
    .select({
      install: tenantExtensionInstalls,
      pkg: extensionPackages,
      version: extensionVersions,
      publisher: tenants,
    })
    .from(tenantExtensionInstalls)
    .innerJoin(extensionPackages, eq(extensionPackages.id, tenantExtensionInstalls.packageId))
    .innerJoin(extensionVersions, eq(extensionVersions.id, tenantExtensionInstalls.versionId))
    .innerJoin(tenants, eq(tenants.id, extensionPackages.tenantId))
    .where(acrossTenants(
      tenantExtensionInstalls,
      'public_catalogue',
      eq(tenantExtensionInstalls.id, installId),
      // THE authorization predicate: the package must belong to the workspace
      // whose key is making this call. Without it a publisher could mint tokens
      // against another publisher's installs by guessing an id.
      eq(extensionPackages.tenantId, publisherTenantId),
      sql`${tenantExtensionInstalls.disabledAt} is null`,
      sql`${tenants.publisherSuspendedAt} is null`,
    ))
    .limit(1);
  if (!row) return null;
  return {
    installId: row.install.id,
    tenantId: row.install.tenantId,
    publisherTenantId: row.pkg.tenantId,
    packageId: row.pkg.id,
    packageSlug: row.pkg.slug,
    versionId: row.version.id,
    semver: row.version.semver,
    grantedScopes: row.install.grantedScopes ?? [],
    planCode: row.install.planCode,
    subscriptionState: row.install.subscriptionState,
    meteredSince: row.install.meteredSince ?? null,
  };
}

/**
 * Exchange a publisher's authority over an install for a token bounded by it.
 *
 * `publisherTenantId` comes from the RESOLVED API key, never from the request
 * body — that is the whole of the client half of client-credentials, and taking
 * it from the body would let anybody who knows an install id mint a token for it.
 *
 * The scopes minted are the install's, unchanged. A caller may narrow them
 * (`requestScopes`) and may not widen them: asking for something the admin did not
 * approve returns a token without it rather than an error, because the vendor may
 * legitimately be asking for the union of what their integration can use, and a
 * refusal would make a partially-granted install unusable instead of partially
 * capable.
 */
export async function mintInstallToken(
  db: Db,
  env: Env,
  input: {
    publisherTenantId: number;
    installId: string;
    requestScopes?: readonly string[] | null;
  },
): Promise<{ accessToken: string; expiresIn: number; scopes: string[]; install: ResolvedInstall }> {
  const install = await loadInstallForPublisher(db, input.installId, input.publisherTenantId);
  // One message for "no such install", "not yours" and "disabled", deliberately:
  // distinguishing them turns an install id into an oracle for which ids exist.
  if (!install) throw new InstallTokenError('No such install', 404);

  // A cancelled subscription is not a smaller grant — it is the end of the
  // commercial relationship, and a vendor still holding a working token after it
  // is how a customer keeps being served something they stopped paying for.
  // `past_due` deliberately still works; see `subscriptionEntitles`.
  if (install.subscriptionState !== 'none' && !subscriptionEntitles(install.subscriptionState)) {
    throw new InstallTokenError('This install is not on an active plan', 403);
  }

  const requested = input.requestScopes?.length ? new Set(input.requestScopes) : null;
  const scopes = requested
    ? install.grantedScopes.filter((s) => requested.has(s))
    : install.grantedScopes;

  const now = Math.floor(Date.now() / 1000);
  const claims: InstallTokenClaims = {
    typ: TOKEN_TYPE,
    sub: install.installId,
    pub: install.publisherTenantId,
    pkg: install.packageId,
    scopes,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  return {
    accessToken: await signOpaqueJwt(claims as unknown as Record<string, unknown>, env.JWT_SECRET),
    expiresIn: TOKEN_TTL_SECONDS,
    scopes,
    install,
  };
}

/**
 * Turn a bearer token back into an install, or refuse.
 *
 * ── THE RE-READ IS THE POINT ────────────────────────────────────────────────
 * The signature proves the token was ours and unexpired; it proves nothing about
 * whether the install still exists, is still enabled, still belongs to that
 * publisher or still carries those scopes. All four can change in the five
 * minutes a token lives, and three of the four are things a customer did on
 * purpose. So the claims are used only to ADDRESS the install, and the install
 * itself decides what the call may do.
 *
 * The grant is intersected with the token's scopes rather than replaced by them:
 * a token minted before an admin narrowed the grant must lose what the admin took
 * away, and a grant widened afterwards must not retroactively widen a token that
 * was issued narrower.
 */
export async function resolveInstallToken(
  db: Db,
  env: Env,
  authorizationHeader: string | undefined,
): Promise<ResolvedInstall> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new InstallTokenError('Missing or malformed Authorization header', 401);
  }
  let claims: InstallTokenClaims;
  try {
    claims = await verifyOpaqueJwt<InstallTokenClaims>(authorizationHeader.slice(7).trim(), env.JWT_SECRET);
  } catch {
    // One message for forged, expired and malformed — the same reason
    // `requirePublicApiKey` gives: a distinguishing error is a probe.
    throw new InstallTokenError('Invalid or expired install token', 401);
  }
  if (claims.typ !== TOKEN_TYPE) throw new InstallTokenError('Invalid or expired install token', 401);

  const install = await loadInstallForPublisher(db, claims.sub, claims.pub);
  if (!install || install.packageId !== claims.pkg) {
    throw new InstallTokenError('This install is no longer available', 401);
  }
  if (install.subscriptionState !== 'none' && !subscriptionEntitles(install.subscriptionState)) {
    throw new InstallTokenError('This install is not on an active plan', 403);
  }

  const minted = new Set(claims.scopes ?? []);
  return { ...install, grantedScopes: install.grantedScopes.filter((s) => minted.has(s)) };
}

/**
 * Does this resolved install permit `scope`? Strict — an empty grant permits
 * nothing, which is `installGrants`, which is the same predicate the tool catalog
 * and the connector runtime use. There is no second scope check for vendors.
 */
export function tokenPermits(install: ResolvedInstall, scope: ExtensionScope): boolean {
  return installGrants(install.grantedScopes, scope);
}

/** The same question, as a refusal. Saves every handler writing the same `if`. */
export function requireTokenScope(install: ResolvedInstall, scope: ExtensionScope): void {
  if (!tokenPermits(install, scope)) {
    throw new InstallTokenError(`This install was not granted ${scope}`, 403);
  }
}

export interface PublisherInstallRow {
  installId: string;
  packageSlug: string;
  semver: string;
  grantedScopes: string[];
  planCode: string | null;
  subscriptionState: string;
  installedAtISO: string | null;
}

/**
 * Every live install of this publisher's packages, as HANDLES.
 *
 * ── WHY THIS IS HERE AND NOT IN `installAnalytics` ──────────────────────────
 * That module's boundary is absolute and correct: a publisher never learns WHICH
 * workspace installed their package, and every read in it is an aggregate over
 * non-tenant dimensions. This is a different question with a different answer.
 * A vendor whose integration server restarts, or who missed a webhook, needs to
 * enumerate the installs they are expected to serve — and an install id is not
 * the customer's identity. It is an opaque handle we minted, whose only power is
 * to be exchanged (by this publisher alone) for a token bounded by what that
 * install's admin already approved.
 *
 * So the projection deliberately carries NO tenant id, no workspace name and
 * nothing that could be joined back to one. It is the same read
 * `loadInstallForPublisher` makes, over the set rather than the row, pinned by
 * the same authorization predicate — the package must belong to the calling
 * publisher — which is what makes `public_catalogue` the honest reason here too.
 *
 * If an operator ever wants IDENTIFIED installs, the change is not a flag: it is
 * a new entry in `EXTENSION_SCOPES`, which appears on the consent screen and is
 * approved per install. `installAnalytics` makes that argument in full.
 */
export async function listPublisherInstalls(
  db: Db,
  publisherTenantId: number,
  options: { packageSlug?: string | null; limit?: number } = {},
): Promise<PublisherInstallRow[]> {
  const limit = Math.min(500, Math.max(1, Math.trunc(options.limit ?? 100)));
  const rows = await db
    .select({
      installId: tenantExtensionInstalls.id,
      packageSlug: extensionPackages.slug,
      semver: extensionVersions.semver,
      grantedScopes: tenantExtensionInstalls.grantedScopes,
      planCode: tenantExtensionInstalls.planCode,
      subscriptionState: tenantExtensionInstalls.subscriptionState,
      createdAt: tenantExtensionInstalls.createdAt,
    })
    .from(tenantExtensionInstalls)
    .innerJoin(extensionPackages, eq(extensionPackages.id, tenantExtensionInstalls.packageId))
    .innerJoin(extensionVersions, eq(extensionVersions.id, tenantExtensionInstalls.versionId))
    .where(acrossTenants(
      tenantExtensionInstalls,
      'public_catalogue',
      eq(extensionPackages.tenantId, publisherTenantId),
      sql`${tenantExtensionInstalls.disabledAt} is null`,
      options.packageSlug ? eq(extensionPackages.slug, options.packageSlug) : undefined,
    ))
    .orderBy(desc(tenantExtensionInstalls.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    installId: r.installId,
    packageSlug: r.packageSlug,
    semver: r.semver,
    grantedScopes: r.grantedScopes ?? [],
    planCode: r.planCode,
    subscriptionState: r.subscriptionState,
    installedAtISO: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }));
}

/** Exported for the tests and for the docs generator — never for a caller to tune. */
export const INSTALL_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;

