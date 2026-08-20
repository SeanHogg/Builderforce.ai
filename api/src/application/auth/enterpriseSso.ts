/**
 * Institutional SSO — and the SAML decision, in the one place it is enforced.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 * A university authenticates through an institutional IdP — Shibboleth behind
 * InCommon, Microsoft Entra, Okta — and procurement does not begin without it.
 * LTI 1.3 gets the tool into the LMS; SSO is what gets it past the security
 * review. Without it, no institution can buy the academic vocabulary, however
 * complete the vocabulary is.
 *
 * ── THE DECISION ─────────────────────────────────────────────────────────────
 * SAML 2.0 is TERMINATED AT A GATEWAY THAT ALREADY SPEAKS IT. Only OIDC runs in
 * this process.
 *
 * The tool half of SAML is easy — SP metadata, an `AuthnRequest` over
 * HTTP-Redirect, an ACS endpoint. The part that is not is verifying the signed
 * Response: exclusive XML canonicalisation, then reference-digest validation,
 * then the RSA check, in that order and with the claims read from the subtree
 * that was actually verified. A mistake anywhere in that sequence is an XML
 * signature-wrapping AUTHENTICATION BYPASS, and its defining property is that it
 * looks exactly like a working login until somebody forges an assertion. It also
 * cannot be validated without a live institutional IdP to test against.
 *
 * So the customer points their IdP at an SSO gateway of their choosing (WorkOS,
 * Auth0, Okta, Entra — all of which speak SAML to Shibboleth and OIDC to us),
 * and every signature THIS codebase verifies stays an RS256 JWS: the primitive
 * WebCrypto implements natively and `infrastructure/auth/jws.ts` already owns for
 * LTI launches and GitHub OIDC. The institution gets the integration they asked
 * for; we do not acquire an authentication-bypass surface to maintain forever.
 *
 * `sso_connections.protocol` records that decision as data. Only 'oidc' is
 * accepted, and the refusal explains itself rather than 404ing.
 *
 * ── HOW A PERSON REACHES THEIR IdP ───────────────────────────────────────────
 * By email domain. `sso_domains` maps one domain to exactly one connection, and
 * ONLY a verified row routes — an unverified claim on `physics.edu` would be a
 * takeover of every sign-in from it, which is why `startSsoLogin` will not use
 * one and `verifyDomain` exists.
 */

import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ssoConnections, ssoDomains } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { parseJws, randomUrlToken, verifyJwsWithJwks } from '../../infrastructure/auth/jws';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  challengeRecordName, newChallengeToken, normalizeHostname, verifyChallengeToken,
  type DnsLookupDeps,
} from '../shared/dnsVerification';
import type { Env } from '../../env';

const SOURCE = 'application/auth/enterpriseSso.ts';

/** The only protocol this module implements. See the header. */
export const SUPPORTED_PROTOCOL = 'oidc';

const DISCOVERY_TTL_SECONDS = 21_600;
const CLOCK_LEEWAY_SECONDS = 60;

export class SsoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SsoError';
  }
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** What a screen may see. No client secret, no ciphertext. */
export interface SsoConnectionView {
  id: number;
  label: string;
  protocol: string;
  issuer: string;
  discoveryUrl: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  jwksUrl: string | null;
  userinfoUrl: string | null;
  clientId: string;
  scopes: string;
  jitProvisioning: boolean;
  defaultRole: string;
  status: string;
  domains: Array<{ id: number; domain: string; verified: boolean; verifyToken: string }>;
}

export interface SsoConnectionInput {
  label: string;
  protocol?: string;
  issuer: string;
  discoveryUrl?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
  jwksUrl?: string | null;
  userinfoUrl?: string | null;
  clientId: string;
  /** Present on create, and on an update only when the operator is replacing it —
   *  an empty value LEAVES THE STORED SECRET ALONE rather than blanking it, so a
   *  screen that renders the form without the secret cannot erase it on save. */
  clientSecret?: string;
  scopes?: string;
  jitProvisioning?: boolean;
  defaultRole?: string;
}

const CONNECTION_COLUMNS = {
  id: ssoConnections.id,
  tenantId: ssoConnections.tenantId,
  label: ssoConnections.label,
  protocol: ssoConnections.protocol,
  issuer: ssoConnections.issuer,
  discoveryUrl: ssoConnections.discoveryUrl,
  authorizationUrl: ssoConnections.authorizationUrl,
  tokenUrl: ssoConnections.tokenUrl,
  jwksUrl: ssoConnections.jwksUrl,
  userinfoUrl: ssoConnections.userinfoUrl,
  clientId: ssoConnections.clientId,
  scopes: ssoConnections.scopes,
  jitProvisioning: ssoConnections.jitProvisioning,
  defaultRole: ssoConnections.defaultRole,
  status: ssoConnections.status,
} as const;

type ConnectionRow = {
  id: number; tenantId: number; label: string; protocol: string; issuer: string;
  discoveryUrl: string | null; authorizationUrl: string | null; tokenUrl: string | null;
  jwksUrl: string | null; userinfoUrl: string | null; clientId: string; scopes: string;
  jitProvisioning: boolean; defaultRole: string; status: string;
};

function requireHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new SsoError(`${field} is not a URL. Copy it from the identity provider's own application screen.`, 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new SsoError(`${field} must be https. A sign-in redirect over plaintext is readable by anybody on the path.`, 400);
  }
  return parsed.toString().slice(0, 2000);
}

function normalize(input: SsoConnectionInput): Omit<SsoConnectionInput, 'clientSecret'> {
  const protocol = (input.protocol ?? SUPPORTED_PROTOCOL).trim().toLowerCase();
  if (protocol !== SUPPORTED_PROTOCOL) {
    throw new SsoError(
      'Only OIDC connections are supported. SAML is terminated at an identity provider that already speaks it — point your Shibboleth or Entra IdP at an SSO gateway (WorkOS, Auth0, Okta, Entra) and connect the gateway here over OIDC.',
      400,
    );
  }
  const label = input.label.trim().slice(0, 160);
  const clientId = input.clientId.trim().slice(0, 255);
  if (!label) throw new SsoError('Name the connection — it is how an administrator recognises it later.', 400);
  if (!clientId) throw new SsoError('The client id the identity provider issued for this application is required.', 400);

  const issuer = requireHttpsUrl(input.issuer, 'The issuer');
  const discoveryUrl = input.discoveryUrl?.trim() ? requireHttpsUrl(input.discoveryUrl, 'The discovery URL') : null;
  const authorizationUrl = input.authorizationUrl?.trim() ? requireHttpsUrl(input.authorizationUrl, 'The authorization endpoint') : null;
  const tokenUrl = input.tokenUrl?.trim() ? requireHttpsUrl(input.tokenUrl, 'The token endpoint') : null;
  const jwksUrl = input.jwksUrl?.trim() ? requireHttpsUrl(input.jwksUrl, 'The JWKS endpoint') : null;
  const userinfoUrl = input.userinfoUrl?.trim() ? requireHttpsUrl(input.userinfoUrl, 'The userinfo endpoint') : null;

  // Discovery OR the three endpoints. Neither is a connection that cannot start a
  // login, and finding that out at sign-in time is finding it out from a user.
  if (!discoveryUrl && !(authorizationUrl && tokenUrl && jwksUrl)) {
    throw new SsoError(
      'Give either a discovery URL, or the authorization, token and JWKS endpoints. Without one of those there is nowhere to send a person to sign in.',
      400,
    );
  }

  const scopes = (input.scopes ?? 'openid email profile').trim().slice(0, 255);
  if (!scopes.split(/\s+/).includes('openid')) {
    throw new SsoError('The scopes must include `openid` — without it the provider returns no id_token and there is nothing to verify.', 400);
  }

  return {
    label, protocol, issuer, discoveryUrl, authorizationUrl, tokenUrl, jwksUrl, userinfoUrl,
    clientId, scopes,
    jitProvisioning: input.jitProvisioning !== false,
    defaultRole: (input.defaultRole ?? 'developer').trim().slice(0, 32),
  };
}

async function domainsFor(db: Db, tenantId: number, connectionIds: number[]): Promise<Map<number, SsoConnectionView['domains']>> {
  const byConnection = new Map<number, SsoConnectionView['domains']>();
  if (!connectionIds.length) return byConnection;
  const rows = await db
    .select({
      id: ssoDomains.id,
      connectionId: ssoDomains.connectionId,
      domain: ssoDomains.domain,
      verifiedAt: ssoDomains.verifiedAt,
      verifyToken: ssoDomains.verifyToken,
    })
    .from(ssoDomains)
    .where(scopedToTenant(ssoDomains, tenantId));
  for (const row of rows) {
    const list = byConnection.get(row.connectionId) ?? [];
    list.push({ id: row.id, domain: row.domain, verified: row.verifiedAt != null, verifyToken: row.verifyToken });
    byConnection.set(row.connectionId, list);
  }
  return byConnection;
}

const toView = (row: ConnectionRow, domains: SsoConnectionView['domains']): SsoConnectionView => ({
  id: row.id,
  label: row.label,
  protocol: row.protocol,
  issuer: row.issuer,
  discoveryUrl: row.discoveryUrl,
  authorizationUrl: row.authorizationUrl,
  tokenUrl: row.tokenUrl,
  jwksUrl: row.jwksUrl,
  userinfoUrl: row.userinfoUrl,
  clientId: row.clientId,
  scopes: row.scopes,
  jitProvisioning: row.jitProvisioning,
  defaultRole: row.defaultRole,
  status: row.status,
  domains,
});

export async function listConnections(db: Db, tenantId: number): Promise<SsoConnectionView[]> {
  const rows = await db
    .select(CONNECTION_COLUMNS)
    .from(ssoConnections)
    .where(scopedToTenant(ssoConnections, tenantId))
    .orderBy(ssoConnections.label);
  const domains = await domainsFor(db, tenantId, rows.map((row) => row.id));
  return rows.map((row) => toView(row, domains.get(row.id) ?? []));
}

export async function createConnection(
  env: Env,
  db: Db,
  tenantId: number,
  input: SsoConnectionInput,
  createdBy: string | null,
): Promise<SsoConnectionView> {
  const clean = normalize(input);
  const secret = input.clientSecret?.trim() ?? '';
  if (!secret) throw new SsoError('The client secret the identity provider issued is required.', 400);
  const sealed = await encryptCredentials({ clientSecret: secret }, credentialSecret(env), tenantId);

  const [row] = await db
    .insert(ssoConnections)
    .values({
      tenantId,
      label: clean.label,
      protocol: clean.protocol!,
      issuer: clean.issuer,
      discoveryUrl: clean.discoveryUrl ?? null,
      authorizationUrl: clean.authorizationUrl ?? null,
      tokenUrl: clean.tokenUrl ?? null,
      jwksUrl: clean.jwksUrl ?? null,
      userinfoUrl: clean.userinfoUrl ?? null,
      clientId: clean.clientId,
      clientSecretEnc: sealed.enc,
      clientSecretIv: sealed.iv,
      scopes: clean.scopes!,
      jitProvisioning: clean.jitProvisioning!,
      defaultRole: clean.defaultRole!,
      createdBy,
    })
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new SsoError('The connection could not be saved.', 500);
  return toView(row, []);
}

export async function updateConnection(
  env: Env,
  db: Db,
  tenantId: number,
  id: number,
  input: SsoConnectionInput,
): Promise<SsoConnectionView> {
  const clean = normalize(input);
  const secret = input.clientSecret?.trim() ?? '';
  // Empty LEAVES the stored secret alone. A screen that cannot render a secret it
  // never receives would otherwise blank it on every save.
  const sealed = secret ? await encryptCredentials({ clientSecret: secret }, credentialSecret(env), tenantId) : null;

  const [row] = await db
    .update(ssoConnections)
    .set({
      label: clean.label,
      protocol: clean.protocol!,
      issuer: clean.issuer,
      discoveryUrl: clean.discoveryUrl ?? null,
      authorizationUrl: clean.authorizationUrl ?? null,
      tokenUrl: clean.tokenUrl ?? null,
      jwksUrl: clean.jwksUrl ?? null,
      userinfoUrl: clean.userinfoUrl ?? null,
      clientId: clean.clientId,
      scopes: clean.scopes!,
      jitProvisioning: clean.jitProvisioning!,
      defaultRole: clean.defaultRole!,
      ...(sealed ? { clientSecretEnc: sealed.enc, clientSecretIv: sealed.iv } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(ssoConnections, tenantId, eq(ssoConnections.id, id)))
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new SsoError('That connection does not exist in this workspace.', 404);
  await invalidateCached(env, discoveryCacheKey(row.id));
  const domains = await domainsFor(db, tenantId, [row.id]);
  return toView(row, domains.get(row.id) ?? []);
}

export async function deleteConnection(env: Env, db: Db, tenantId: number, id: number): Promise<void> {
  const [row] = await db
    .delete(ssoConnections)
    .where(scopedToTenant(ssoConnections, tenantId, eq(ssoConnections.id, id)))
    .returning({ id: ssoConnections.id });
  if (!row) throw new SsoError('That connection does not exist in this workspace.', 404);
  await invalidateCached(env, discoveryCacheKey(id));
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** Reject anything that is not a bare registrable name. A "domain" with a path,
 *  a port or a scheme would never match an email suffix and is a claim somebody
 *  will believe took effect. */
function normalizeDomain(value: string): string {
  const clean = normalizeHostname(value.trim().replace(/^@/, ''));
  if (!clean) {
    throw new SsoError(`"${value}" is not a domain. Use the bare name people's addresses end in, e.g. physics.edu.`, 400);
  }
  return clean;
}

export async function addDomain(db: Db, tenantId: number, connectionId: number, domain: string): Promise<{ domain: string; verifyToken: string }> {
  const clean = normalizeDomain(domain);
  const [connection] = await db
    .select({ id: ssoConnections.id })
    .from(ssoConnections)
    .where(scopedToTenant(ssoConnections, tenantId, eq(ssoConnections.id, connectionId)))
    .limit(1);
  if (!connection) throw new SsoError('That connection does not exist in this workspace.', 404);

  // The platform's ONE domain-proof token format and record name — `sso` is the
  // third purpose in `CHALLENGE_PREFIX`. Minting a bespoke token here would have
  // been a second domain-ownership model, which is exactly what that module was
  // extracted to prevent.
  const verifyToken = newChallengeToken();
  const [row] = await db
    .insert(ssoDomains)
    .values({ tenantId, connectionId, domain: clean, verifyToken })
    .onConflictDoNothing({ target: ssoDomains.domain })
    .returning({ domain: ssoDomains.domain, verifyToken: ssoDomains.verifyToken });
  if (!row) {
    throw new SsoError(
      `${clean} is already claimed. A domain routes to exactly one connection — an ambiguous answer at a sign-in boundary gets resolved arbitrarily rather than refused.`,
      409,
    );
  }
  return row;
}

export async function removeDomain(db: Db, tenantId: number, domainId: number): Promise<void> {
  const [row] = await db
    .delete(ssoDomains)
    .where(scopedToTenant(ssoDomains, tenantId, eq(ssoDomains.id, domainId)))
    .returning({ id: ssoDomains.id });
  if (!row) throw new SsoError('That domain is not claimed by this workspace.', 404);
}

/** One claimed row, as both the button and the sweep read it. */
interface ClaimedDomainRow {
  id: number;
  tenantId: number;
  domain: string;
  verifyToken: string;
}

/**
 * THE verify-and-stamp step: look for this row's token in DNS and, if it is
 * there, record that it is verified.
 *
 * Written once because there are two ways in — an administrator pressing the
 * button and the sweep that runs whether or not anybody presses it — and a second
 * copy of "compare, then stamp" is a second answer to the only question that
 * governs whether a domain may route sign-ins. The stamp is always scoped to the
 * ROW'S OWN tenant, so the caller cannot widen it by supplying a different one.
 */
async function checkAndStampDomain(
  db: Db,
  row: ClaimedDomainRow,
  deps: DnsLookupDeps,
): Promise<{ verified: boolean; recordName: string; found: string[] }> {
  const result = await verifyChallengeToken('sso', row.domain, row.verifyToken, deps);
  if (result.verified) {
    await db
      .update(ssoDomains)
      .set({ verifiedAt: new Date() })
      .where(scopedToTenant(ssoDomains, row.tenantId, eq(ssoDomains.id, row.id)));
  }
  return result;
}

/**
 * Prove control of a domain before it is allowed to route sign-ins.
 *
 * Delegates to `verifyChallengeToken`, which resolves the TXT record over
 * DNS-over-HTTPS and compares EXACTLY — a prefix match would accept
 * `<somebody else's token>-and-more`, which is the shape of a real bypass rather
 * than a hypothetical one. `fetchImpl` is injectable there, so this is testable
 * without a network and without a second resolver.
 */
export async function verifyDomain(
  db: Db,
  tenantId: number,
  domainId: number,
  deps: DnsLookupDeps = {},
): Promise<{ verified: boolean; recordName: string; expected: string; found: string[] }> {
  const [row] = await db
    .select({
      id: ssoDomains.id,
      tenantId: ssoDomains.tenantId,
      domain: ssoDomains.domain,
      verifyToken: ssoDomains.verifyToken,
    })
    .from(ssoDomains)
    .where(scopedToTenant(ssoDomains, tenantId, eq(ssoDomains.id, domainId)))
    .limit(1);
  if (!row) throw new SsoError('That domain is not claimed by this workspace.', 404);

  const result = await checkAndStampDomain(db, row, deps);
  return { verified: result.verified, recordName: result.recordName, expected: row.verifyToken, found: result.found };
}

/** How many unverified claims one tick looks at. Bounded for the reason every
 *  sweep in here is: a scheduled job must not become an unbounded scan, and each
 *  row costs one outbound DNS-over-HTTPS request. */
const SSO_DOMAIN_SWEEP_BATCH = 10;

export interface SsoDomainSweepResult {
  checked: number;
  verified: number;
}

/**
 * The claim that nobody came back to press the button on.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `addDomain` mints a token and tells an administrator to publish a TXT record.
 * Publishing it is somebody else's job at somebody else's DNS provider, and it
 * lands minutes or days later — by which time the person who started the claim
 * has closed the tab. Until this sweep, the only thing that could ever notice the
 * record had appeared was a human pressing "verify" on a screen they had no
 * reason to reopen, so an institution that did exactly what it was asked stayed
 * unrouted until it complained. A proof that only counts while someone is
 * watching is not a proof, it is a form.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Deliberately cross-tenant: there is no caller and therefore no tenant to filter
 * by. The read declares that with `acrossTenants`, and the WRITE is still scoped
 * to the row's own `tenant_id` inside `checkAndStampDomain` — the sweep widens
 * what is READ, never what one row's stamp can touch.
 *
 * Never throws. A DNS outage or one malformed row must not abort the cron tick
 * that also runs everything else.
 */
export async function runSsoDomainSweep(
  db: Db,
  opts: { maxDomains?: number; deps?: DnsLookupDeps } = {},
): Promise<SsoDomainSweepResult> {
  const deps = opts.deps ?? {};
  let pending: ClaimedDomainRow[];
  try {
    pending = await db
      .select({
        id: ssoDomains.id,
        tenantId: ssoDomains.tenantId,
        domain: ssoDomains.domain,
        verifyToken: ssoDomains.verifyToken,
      })
      .from(ssoDomains)
      // Only what is still unproven. An already-verified row is not re-checked:
      // a domain that routes must not stop routing because a resolver blipped.
      .where(acrossTenants(ssoDomains, 'scheduled_sweep', isNull(ssoDomains.verifiedAt)))
      .orderBy(asc(ssoDomains.createdAt))
      .limit(Math.max(1, Math.min(opts.maxDomains ?? SSO_DOMAIN_SWEEP_BATCH, 100)));
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'runSsoDomainSweep' });
    return { checked: 0, verified: 0 };
  }

  let verified = 0;
  for (const row of pending) {
    try {
      const result = await checkAndStampDomain(db, row, deps);
      if (result.verified) verified += 1;
    } catch (error) {
      // Per row, never per batch — one unreachable zone must not stop the other
      // nine claims from being proved on this tick.
      reportCaughtError(error, {
        source: SOURCE,
        operation: 'runSsoDomainSweep',
        context: { domainId: row.id, tenantId: row.tenantId },
      });
    }
  }
  return { checked: pending.length, verified };
}

/** The FQDN an administrator has to create the TXT record at. Echoed by the
 *  screen so nobody has to remember the prefix. */
export const ssoChallengeRecordName = (domain: string): string => challengeRecordName('sso', domain);

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

const discoveryCacheKey = (connectionId: number) => `sso:discovery:${connectionId}`;

interface Endpoints {
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  userinfoUrl: string | null;
  issuer: string;
}

/**
 * The four endpoints, from the connection or from the provider's own discovery
 * document.
 *
 * TYPED VALUES WIN. A provider whose discovery document is wrong (or returns a
 * `token_endpoint` on a host their firewall does not permit) is still connectable
 * by an operator who types the right one, which is worth more than the tidier
 * rule that discovery always overrides.
 */
async function resolveEndpoints(env: Env, connection: ConnectionRow): Promise<Endpoints | null> {
  const typed = {
    authorizationUrl: connection.authorizationUrl,
    tokenUrl: connection.tokenUrl,
    jwksUrl: connection.jwksUrl,
    userinfoUrl: connection.userinfoUrl,
    issuer: connection.issuer,
  };
  if (typed.authorizationUrl && typed.tokenUrl && typed.jwksUrl) {
    return { ...typed, authorizationUrl: typed.authorizationUrl, tokenUrl: typed.tokenUrl, jwksUrl: typed.jwksUrl };
  }
  if (!connection.discoveryUrl) return null;

  const document = await getOrSetCached<Record<string, unknown> | null>(env, discoveryCacheKey(connection.id), async () => {
    const response = await fetch(connection.discoveryUrl!, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  }, { kvTtlSeconds: DISCOVERY_TTL_SECONDS }).catch(() => null);
  if (!document) return null;

  const read = (key: string): string | null => (typeof document[key] === 'string' ? document[key] as string : null);
  const authorizationUrl = typed.authorizationUrl ?? read('authorization_endpoint');
  const tokenUrl = typed.tokenUrl ?? read('token_endpoint');
  const jwksUrl = typed.jwksUrl ?? read('jwks_uri');
  if (!authorizationUrl || !tokenUrl || !jwksUrl) return null;
  return {
    authorizationUrl,
    tokenUrl,
    jwksUrl,
    userinfoUrl: typed.userinfoUrl ?? read('userinfo_endpoint'),
    // The discovery document's own `issuer` is authoritative for token
    // verification — it is what the provider will actually put in `iss`, and a
    // typo in the typed one would reject every login with "wrong issuer".
    issuer: read('issuer') ?? typed.issuer,
  };
}

/** The connection an email address routes to, or null. VERIFIED domains only. */
export async function connectionForEmail(db: Db, email: string): Promise<ConnectionRow | null> {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return null;
  const [row] = await db
    .select(CONNECTION_COLUMNS)
    .from(ssoDomains)
    .innerJoin(ssoConnections, eq(ssoConnections.id, ssoDomains.connectionId))
    // A person signing in has no session and therefore no tenant — the domain IS
    // the routing credential and the row reports whose connection it is. The
    // access predicate is the verified domain, which `acrossTenants` requires.
    .where(acrossTenants(
      ssoDomains,
      'share_token',
      eq(ssoDomains.domain, domain),
      isNotNull(ssoDomains.verifiedAt),
      eq(ssoConnections.status, 'active'),
    ))
    .limit(1);
  return row ?? null;
}

export async function connectionById(db: Db, id: number): Promise<ConnectionRow | null> {
  const [row] = await db
    .select(CONNECTION_COLUMNS)
    .from(ssoConnections)
    .where(acrossTenants(ssoConnections, 'share_token', eq(ssoConnections.id, id), eq(ssoConnections.status, 'active')))
    .limit(1);
  return row ?? null;
}

export interface SsoStart {
  url: string;
  nonce: string;
}

/**
 * Where to send somebody to authenticate.
 *
 * The returned URL deliberately carries NO `state`. The nonce is minted here and
 * has to be signed INTO the state, so the state cannot exist until this has run —
 * the caller adds it. That also keeps `JWT_SECRET` and the shape of a callback URL
 * out of this module entirely, which is the layer line.
 */
export async function startSsoLogin(
  env: Env,
  connection: ConnectionRow,
  redirectUri: string,
): Promise<SsoStart> {
  const endpoints = await resolveEndpoints(env, connection);
  if (!endpoints) {
    throw new SsoError('This connection has no usable endpoints. Check its discovery URL, or type the authorization, token and JWKS endpoints.', 502);
  }
  const nonce = randomUrlToken(24);
  const url = new URL(endpoints.authorizationUrl);
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: connection.clientId,
    redirect_uri: redirectUri,
    scope: connection.scopes,
    nonce,
  })) url.searchParams.set(key, value);
  return { url: url.toString(), nonce };
}

export interface SsoIdentity {
  /** The provider's stable subject. What the account is bound to — never the
   *  email, which changes with a surname. */
  subject: string;
  email: string;
  name: string;
  connection: ConnectionRow;
}

export type SsoCompletion =
  | { ok: true; identity: SsoIdentity }
  | { ok: false; error: string };

async function clientSecretFor(env: Env, db: Db, connection: ConnectionRow): Promise<string | null> {
  const [row] = await db
    .select({ enc: ssoConnections.clientSecretEnc, iv: ssoConnections.clientSecretIv })
    .from(ssoConnections)
    .where(scopedToTenant(ssoConnections, connection.tenantId, eq(ssoConnections.id, connection.id)))
    .limit(1);
  if (!row) return null;
  const opened = await decryptCredentials(row.enc, row.iv, credentialSecret(env), connection.tenantId);
  return typeof opened?.clientSecret === 'string' ? opened.clientSecret : null;
}

/**
 * Exchange the code, verify the id_token, and read who signed in.
 *
 * The checks, in order and all of them: signature against the provider's JWKS
 * (the shared verifier, which also refuses any `alg` but RS256), issuer, audience
 * — so a token minted for a DIFFERENT application at the same IdP cannot be
 * replayed here — nonce, and expiry with the platform's usual 60s leeway.
 *
 * Every failure returns a reason. The route turns them into a sign-in error page,
 * and the reason is the only thing the person or their administrator gets.
 */
export async function completeSsoLogin(
  env: Env,
  db: Db,
  connection: ConnectionRow,
  code: string,
  redirectUri: string,
  expectedNonce: string,
): Promise<SsoCompletion> {
  const endpoints = await resolveEndpoints(env, connection);
  if (!endpoints) return { ok: false, error: 'This connection has no usable endpoints.' };

  const clientSecret = await clientSecretFor(env, db, connection);
  if (!clientSecret) return { ok: false, error: 'This connection has no client secret stored. Re-enter it in Settings → Security.' };

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: connection.clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'completeSsoLogin.token' });
    return { ok: false, error: 'The identity provider could not be reached.' };
  }
  if (!tokenResponse.ok) return { ok: false, error: `The identity provider rejected the sign-in (${tokenResponse.status}).` };

  const body = await tokenResponse.json().catch(() => null) as { id_token?: string } | null;
  const idToken = typeof body?.id_token === 'string' ? body.id_token : '';
  if (!idToken) return { ok: false, error: 'The identity provider returned no id_token. Check that the connection requests the `openid` scope.' };

  const parsed = parseJws(idToken);
  if (!parsed) return { ok: false, error: 'The id_token is malformed.' };

  const signature = await verifyJwsWithJwks(env, {
    url: endpoints.jwksUrl,
    cacheKey: `sso:jwks:${connection.id}`,
  }, parsed);
  if (!signature.ok) return { ok: false, error: signature.error };

  const { payload } = parsed;
  if (payload.iss !== endpoints.issuer) return { ok: false, error: 'The id_token was issued by a different provider than this connection names.' };

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(connection.clientId)) {
    return { ok: false, error: 'The id_token was issued for a different application.' };
  }

  if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
    return { ok: false, error: 'The id_token does not belong to this sign-in attempt.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!exp || now > exp + CLOCK_LEEWAY_SECONDS) return { ok: false, error: 'The id_token has expired.' };

  const subject = typeof payload.sub === 'string' ? payload.sub : '';
  if (!subject) return { ok: false, error: 'The id_token carries no subject, so there is nobody to sign in.' };

  let email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  let name = typeof payload.name === 'string' ? payload.name : '';

  // Some providers put the profile behind userinfo rather than in the token.
  // Called only when the token is short of what we need, because it is a second
  // round trip on the critical path of every sign-in.
  if ((!email || !name) && endpoints.userinfoUrl) {
    const accessToken = (body as { access_token?: string } | null)?.access_token;
    if (typeof accessToken === 'string') {
      const profile = await fetch(endpoints.userinfoUrl, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      }).then((response) => (response.ok ? response.json() as Promise<Record<string, unknown>> : null)).catch(() => null);
      if (profile) {
        email = email || (typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '');
        name = name || (typeof profile.name === 'string' ? profile.name : '');
      }
    }
  }

  if (!email.includes('@')) {
    return { ok: false, error: 'The identity provider released no email address, so there is no account to sign in to. Add the `email` scope to the application on their side.' };
  }

  return { ok: true, identity: { subject, email, name: name || email, connection } };
}

/**
 * Does this address still belong to a domain this connection is allowed to
 * authenticate?
 *
 * Checked AFTER the provider answers, not only before. The domain decided where
 * to send the person; it must also decide whether the identity that came back is
 * one this connection may assert. Without this, an IdP that authenticates the
 * whole internet (a misconfigured multi-tenant gateway) could return
 * `attacker@gmail.com` and be believed.
 */
export async function identityIsInScope(db: Db, connection: ConnectionRow, email: string): Promise<boolean> {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  const [row] = await db
    .select({ id: ssoDomains.id })
    .from(ssoDomains)
    .where(scopedToTenant(
      ssoDomains,
      connection.tenantId,
      eq(ssoDomains.connectionId, connection.id),
      eq(ssoDomains.domain, domain),
      isNotNull(ssoDomains.verifiedAt),
    ))
    .limit(1);
  return !!row;
}
