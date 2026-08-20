/**
 * Custom domains for published sites — putting a tenant's OWN hostname on the
 * thing they built.
 *
 * `project_sites.custom_domain` shipped in migration 0193 and was never read or
 * written by anything: no route, no verification, no certificate. This module is
 * the missing half. The lifecycle is deliberately explicit, because "my domain
 * doesn't work" is otherwise unanswerable:
 *
 *   unset
 *     └─ claim(hostname)          → pending_dns          (token issued)
 *          └─ verify()  TXT proof → pending_certificate  (cert requested)
 *               └─ refresh()      → active               (cert issued, routable)
 *                                 → failed               (with a stated reason)
 *
 * Two independent facts have to be true before a request can be served, and they
 * fail for different reasons, so they are separate states:
 *   1. OWNERSHIP — a TXT record we can resolve from the public internet
 *      (`application/shared/dnsVerification.ts`, shared with sender identities).
 *   2. CERTIFICATE — Cloudflare for SaaS issuing a cert for a hostname on a zone
 *      we do not own. This is the one part that needs an entitlement + token.
 *
 * When `CLOUDFLARE_SAAS_API_TOKEN` / `CLOUDFLARE_ZONE_ID` are unset the flow
 * still runs and still verifies ownership; it parks at `pending_certificate`
 * with a stated reason instead of silently claiming success. That degradation is
 * the honest one: routing genuinely cannot work without a certificate.
 */

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites } from '../../infrastructure/database/schema';
import { isUniqueViolation as isUniqueConstraintViolation } from '../../infrastructure/database/uniqueViolation';
import {
  challengeRecordName,
  newChallengeToken,
  normalizeHostname,
  resolveCnameTargets,
  verifyChallengeToken,
  type DnsLookupDeps,
} from '../shared/dnsVerification';
import { HOSTING_APEX, invalidateCustomDomain } from './siteHosting';

/** Every state `custom_domain_status` can hold. */
export type CustomDomainStatus =
  | 'unset'
  | 'pending_dns'
  | 'pending_certificate'
  | 'active'
  | 'failed';

/** What the tenant has to put in their DNS panel, rendered by the UI verbatim. */
export interface DomainInstructions {
  /** TXT record proving ownership. */
  txt: { name: string; value: string };
  /** CNAME pointing traffic at us. */
  cname: { name: string; value: string };
}

export interface CustomDomainState {
  hostname: string | null;
  status: CustomDomainStatus;
  verifiedAt: Date | null;
  error: string | null;
  instructions: DomainInstructions | null;
  /** True once the site is genuinely reachable on the custom hostname. */
  live: boolean;
}

/**
 * The DNS instructions for a hostname. Pure — the UI can render them the instant
 * a domain is claimed, before anything has been verified.
 */
export function domainInstructions(hostname: string, token: string): DomainInstructions {
  return {
    txt: { name: challengeRecordName('site', hostname), value: token },
    // Apex domains cannot legally CNAME; Cloudflare (and most modern DNS hosts)
    // support CNAME-flattening at the apex, which is what makes this one
    // instruction work for both `example.com` and `www.example.com`.
    cname: { name: hostname, value: `${HOSTING_APEX}` },
  };
}

// ---------------------------------------------------------------------------
// Cloudflare for SaaS — custom hostname certificates
// ---------------------------------------------------------------------------

/** The subset of the Cloudflare custom-hostname resource we act on. */
export interface CustomHostnameResult {
  ok: boolean;
  /** Cloudflare's id for the hostname, stored so we can poll/delete it. */
  hostnameId?: string;
  /** `pending_validation` | `active` | `blocked` | … as reported by Cloudflare. */
  certificateStatus?: string;
  error?: string;
}

/** Injectable Cloudflare client so the lifecycle is testable without an account. */
export interface CustomHostnameClient {
  create(hostname: string): Promise<CustomHostnameResult>;
  status(hostnameId: string): Promise<CustomHostnameResult>;
  remove(hostnameId: string): Promise<void>;
}

interface CfEnvelope {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { id?: string; status?: string; ssl?: { status?: string } };
}

/**
 * Is this the platform-wide custom-domain unique-index violation?
 *
 * Postgres reports a unique conflict as SQLSTATE 23505, and drivers surface the
 * code in different places, so both the code and the message are checked. The
 * match narrows on the CONSTRAINT NAME as well: a different unique violation in
 * the same statement must never be reported to the user as "that domain is taken".
 */
export function isUniqueViolation(error: unknown): boolean {
  return isUniqueConstraintViolation(error, 'uq_project_sites_custom_domain');
}

function cfError(body: CfEnvelope, fallback: string): string {
  const first = body?.errors?.[0]?.message;
  return typeof first === 'string' && first ? first : fallback;
}

/**
 * Real Cloudflare for SaaS client, or null when the account is not configured.
 * Returning null (rather than a client that throws) is what lets the caller
 * park at `pending_certificate` with a truthful reason.
 */
export function cloudflareHostnameClient(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): CustomHostnameClient | null {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CLOUDFLARE_SAAS_API_TOKEN;
  if (!zoneId || !token) return null;

  const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  return {
    async create(hostname) {
      try {
        const res = await fetchImpl(base, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            hostname,
            // http validation: Cloudflare serves the token over our own edge, so
            // the tenant does not need a second DNS record beyond the CNAME.
            ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
          }),
        });
        const body = (await res.json().catch(() => ({}))) as CfEnvelope;
        if (!res.ok || body.success === false) {
          return { ok: false, error: cfError(body, `Cloudflare returned ${res.status}`) };
        }
        return {
          ok: true,
          hostnameId: body.result?.id,
          certificateStatus: body.result?.ssl?.status ?? body.result?.status,
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Cloudflare request failed' };
      }
    },
    async status(hostnameId) {
      try {
        const res = await fetchImpl(`${base}/${hostnameId}`, { headers });
        const body = (await res.json().catch(() => ({}))) as CfEnvelope;
        if (!res.ok || body.success === false) {
          return { ok: false, error: cfError(body, `Cloudflare returned ${res.status}`) };
        }
        return {
          ok: true,
          hostnameId: body.result?.id,
          certificateStatus: body.result?.ssl?.status ?? body.result?.status,
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Cloudflare request failed' };
      }
    },
    async remove(hostnameId) {
      try {
        await fetchImpl(`${base}/${hostnameId}`, { method: 'DELETE', headers });
      } catch (error) {
        // A failed cleanup must never block releasing the domain locally — the
        // hostname is orphaned at Cloudflare, not in our routing table — but an
        // orphan holds a certificate slot, so it is reported rather than lost.
        reportCaughtError(error, { source: 'application/ide/customDomain.ts', operation: 'removeCustomHostname' });
      }
    },
  };
}

/**
 * Map a Cloudflare certificate status onto our lifecycle. Pure, so the mapping
 * is directly testable — it is the part most likely to be wrong.
 */
export function statusFromCertificate(certificateStatus: string | undefined): CustomDomainStatus {
  switch (certificateStatus) {
    case 'active':
      return 'active';
    case 'blocked':
    case 'moved':
    case 'deleted':
      return 'failed';
    default:
      // pending_validation / pending_issuance / pending_deployment / initializing
      return 'pending_certificate';
  }
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

export interface DomainOpDeps extends DnsLookupDeps {
  /** Overrides the env-derived client (tests inject a fake; null = unconfigured). */
  hostnameClient?: CustomHostnameClient | null;
}

export type DomainOpResult =
  | { ok: true; state: CustomDomainState }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** Shape the stored row into the state the API returns. */
function toState(row: {
  customDomain: string | null;
  customDomainStatus: string;
  customDomainToken: string | null;
  customDomainVerifiedAt: Date | null;
  customDomainError: string | null;
}): CustomDomainState {
  const status = row.customDomainStatus as CustomDomainStatus;
  return {
    hostname: row.customDomain,
    status,
    verifiedAt: row.customDomainVerifiedAt,
    error: row.customDomainError,
    instructions:
      row.customDomain && row.customDomainToken
        ? domainInstructions(row.customDomain, row.customDomainToken)
        : null,
    live: status === 'active',
  };
}

const SITE_DOMAIN_COLUMNS = {
  customDomain: projectSites.customDomain,
  customDomainStatus: projectSites.customDomainStatus,
  customDomainToken: projectSites.customDomainToken,
  customDomainVerifiedAt: projectSites.customDomainVerifiedAt,
  customDomainError: projectSites.customDomainError,
  customDomainHostnameId: projectSites.customDomainHostnameId,
} as const;

/** Read the current domain state for a project's site. */
export async function getCustomDomain(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<DomainOpResult> {
  const [row] = await db
    .select(SITE_DOMAIN_COLUMNS)
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'This project has no published site yet.' };
  return { ok: true, state: toState(row!) };
}

/**
 * Claim a hostname for this project's site. Issues a fresh challenge token and
 * parks at `pending_dns` — nothing routes until `verifyCustomDomain` succeeds.
 *
 * Claiming a DIFFERENT hostname than the one already set replaces it (and drops
 * the old routing cache entry), so the operation is idempotent per hostname.
 */
export async function claimCustomDomain(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  rawHostname: string,
): Promise<DomainOpResult> {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname) {
    return { ok: false, status: 400, error: 'Enter a domain you own, like example.com.' };
  }

  const [site] = await db
    .select({ id: projectSites.id, customDomain: projectSites.customDomain })
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .limit(1);
  if (!site) return { ok: false, status: 404, error: 'Publish the site first, then add a domain.' };

  // Same tenant, different project — answerable without a cross-tenant read, and
  // the only collision we can describe usefully ("you already use it over there").
  const [mine] = await db
    .select({ projectId: projectSites.projectId })
    .from(projectSites)
    .where(and(
      eq(projectSites.tenantId, tenantId),
      eq(projectSites.customDomain, hostname),
      ne(projectSites.projectId, projectId),
    ))
    .limit(1);
  if (mine) {
    return { ok: false, status: 409, error: `${hostname} is already connected to another project in this workspace.` };
  }

  const previous = site.customDomain;
  const token = newChallengeToken();

  // A hostname claimed by ANOTHER TENANT is deliberately NOT pre-checked: reading
  // across tenants would let anyone probe which domains other customers own. The
  // platform-wide unique index (0412) is the arbiter instead, and its violation is
  // translated here — the database is the only component entitled to see both rows.
  const claimUpdate = () => db
    .update(projectSites)
    .set({
      customDomain: hostname,
      customDomainStatus: 'pending_dns',
      customDomainToken: token,
      customDomainVerifiedAt: null,
      customDomainHostnameId: null,
      customDomainError: null,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .returning(SITE_DOMAIN_COLUMNS);

  let claimed: Awaited<ReturnType<typeof claimUpdate>>;
  try {
    claimed = await claimUpdate();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, error: `${hostname} is already connected to another site.` };
    }
    throw error;
  }
  const row = claimed[0];
  if (!row) return { ok: false, status: 404, error: 'This project has no published site yet.' };

  if (previous && previous !== hostname) await invalidateCustomDomain(env, previous);
  await invalidateCustomDomain(env, hostname);
  return { ok: true, state: toState(row) };
}

/**
 * Check the TXT proof and, once ownership holds, request the certificate.
 *
 * Called both by the tenant clicking "Verify" and by the polling sweep, so it is
 * safe to run repeatedly: an already-active domain short-circuits, and a
 * hostname that already has a Cloudflare id is refreshed rather than recreated.
 */
export async function verifyCustomDomain(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  deps: DomainOpDeps = {},
): Promise<DomainOpResult> {
  const [row] = await db
    .select(SITE_DOMAIN_COLUMNS)
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'This project has no published site yet.' };
  if (!row.customDomain || !row.customDomainToken) {
    return { ok: false, status: 400, error: 'Add a domain before verifying it.' };
  }

  const hostname = row.customDomain;
  const proof = await verifyChallengeToken('site', hostname, row.customDomainToken, deps);
  if (!proof.verified) {
    const detail = proof.found.length
      ? `Found ${proof.found.length} TXT record(s) at ${proof.recordName}, none matching the token.`
      : `No TXT record found at ${proof.recordName} yet. DNS changes can take a few minutes.`;
    const [updated] = await db
      .update(projectSites)
      .set({ customDomainStatus: 'pending_dns', customDomainError: detail, updatedAt: sql`NOW()` })
      .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
      .returning(SITE_DOMAIN_COLUMNS);
    return { ok: true, state: toState(updated!) };
  }

  // Ownership proven. Ask for the certificate — the only step that needs the
  // Cloudflare for SaaS entitlement.
  const client = deps.hostnameClient !== undefined ? deps.hostnameClient : cloudflareHostnameClient(env);
  let status: CustomDomainStatus = 'pending_certificate';
  let hostnameId = row.customDomainHostnameId;
  let error: string | null = null;

  if (!client) {
    error =
      'Ownership verified. Certificate issuance is not configured on this deployment '
      + '(set CLOUDFLARE_ZONE_ID and CLOUDFLARE_SAAS_API_TOKEN), so the domain is not serving yet.';
  } else {
    const result = hostnameId ? await client.status(hostnameId) : await client.create(hostname);
    if (!result.ok) {
      status = 'pending_certificate';
      error = result.error ?? 'Certificate request failed.';
    } else {
      hostnameId = result.hostnameId ?? hostnameId;
      status = statusFromCertificate(result.certificateStatus);
      error = status === 'failed' ? `Cloudflare reported certificate status "${result.certificateStatus}".` : null;
    }
  }

  const [updated] = await db
    .update(projectSites)
    .set({
      customDomainStatus: status,
      customDomainHostnameId: hostnameId ?? null,
      customDomainVerifiedAt: sql`NOW()`,
      customDomainError: error,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .returning(SITE_DOMAIN_COLUMNS);

  // The routing lookup is cached; a domain that just went active must serve now.
  await invalidateCustomDomain(env, hostname);
  return { ok: true, state: toState(updated!) };
}

/** Disconnect the domain: clears routing, drops the cache entry, and best-effort
 *  deletes the Cloudflare hostname so the cert is not left dangling. */
export async function releaseCustomDomain(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  deps: DomainOpDeps = {},
): Promise<DomainOpResult> {
  const [row] = await db
    .select(SITE_DOMAIN_COLUMNS)
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'This project has no published site yet.' };

  const client = deps.hostnameClient !== undefined ? deps.hostnameClient : cloudflareHostnameClient(env);
  if (client && row.customDomainHostnameId) await client.remove(row.customDomainHostnameId);

  const [updated] = await db
    .update(projectSites)
    .set({
      customDomain: null,
      customDomainStatus: 'unset',
      customDomainToken: null,
      customDomainVerifiedAt: null,
      customDomainHostnameId: null,
      customDomainError: null,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .returning(SITE_DOMAIN_COLUMNS);

  if (row.customDomain) await invalidateCustomDomain(env, row.customDomain);
  return { ok: true, state: toState(updated!) };
}

/**
 * Re-check every domain waiting on DNS or a certificate.
 *
 * Neither step completes when the user clicks the button: DNS propagates for
 * minutes and a certificate issues asynchronously. Without this sweep a tenant
 * who set their records correctly and closed the tab would have a domain that
 * never went live until they came back and clicked Verify again.
 *
 * Bounded per tick, oldest-updated first, so a permanently-broken domain cannot
 * starve a newly-added one.
 */
export async function runCustomDomainSweep(
  env: Env,
  db: Db,
  opts: { maxDomains?: number } = {},
): Promise<{ checked: number; activated: number }> {
  const pending = await db
    .select({
      projectId: projectSites.projectId,
      tenantId: projectSites.tenantId,
      status: projectSites.customDomainStatus,
    })
    .from(projectSites)
    .where(inArray(projectSites.customDomainStatus, ['pending_dns', 'pending_certificate']))
    .orderBy(asc(projectSites.updatedAt))
    .limit(opts.maxDomains ?? 10);

  let activated = 0;
  for (const row of pending) {
    const result = await verifyCustomDomain(env, db, row.tenantId, row.projectId);
    if (result.ok && result.state.status === 'active') activated += 1;
  }
  return { checked: pending.length, activated };
}

/**
 * Does the hostname's CNAME actually point at us? Advisory only — surfaced as a
 * hint in the UI because "verified but still 404" is almost always a missing
 * CNAME, and the certificate check alone cannot tell the tenant that.
 */
export async function cnamePointsAtUs(hostname: string, deps: DnsLookupDeps = {}): Promise<boolean> {
  const targets = await resolveCnameTargets(hostname, deps);
  return targets.some((t) => t === HOSTING_APEX || t.endsWith(`.${HOSTING_APEX}`));
}
