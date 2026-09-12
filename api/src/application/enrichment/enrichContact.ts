/**
 * The enrichment vendor port — the thing `enrichment_cache` was built to wrap.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * `agent/aiOperations.cacheLookup` / `cacheStore` (PRD 19 §9) shipped complete,
 * correct and CALLERLESS: Builderforce had no enrichment vendor adapter, so
 * `cacheSavings` could only ever report zero and the "money you did not spend"
 * read was a column of noughts. `sales/contactProfile` records the same absence
 * from the other side — compensation depth "is guessed by an enrichment vendor"
 * that BurnRateOS had and this codebase did not. This is that vendor.
 *
 * ── THE CACHE IS NOT AN OPTIMISATION HERE ───────────────────────────────────
 * Every provider below bills PER LOOKUP. Asking Clearbit twice for the same
 * address is not a slow path, it is a second invoice line. So the cache is not
 * wrapped around the call as a nicety — the call is only ever reachable THROUGH
 * it ({@link enrichContact} is the sole exported entry, and it does the lookup
 * before it will even decrypt a credential). `costCentsAvoided` is written at
 * store time from the vendor's own declared price, because that is the moment
 * the price is known, and it is what makes every later hit report a real number.
 *
 * ── WHAT COMES BACK IS AN OBSERVATION, NOT A FACT ───────────────────────────
 * Everything a vendor returns is written through `contactProfile` at
 * `confidence: 'inferred'` — never `verified`. `compensationBenchmark` reports
 * the confidence MIX beside every median precisely so a recruiter can tell a
 * vendor's guess from a candidate's own number, and an adapter that wrote
 * `verified` would destroy that distinction at the source.
 *
 * ── LAYERING ────────────────────────────────────────────────────────────────
 * Presentation (`revenueIntelRoutes`) depends on this; this depends on the
 * provider catalog, the credential store and the two application services that
 * own the tables. Nothing here knows about Hono or HTTP status codes.
 */
import { asJsonRecord } from '../../domain/shared/json';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { decryptCredentials } from '../integrations/credentialCrypto';
import {
  ENRICHMENT_LOOKUP_OP, ENRICHMENT_PROVIDER_IDS, callProvider, enrichmentSpec, providerSpec,
} from '../integrations/dataProviderCatalog';
import { cacheLookup, cacheSavings, cacheStore } from '../agent/aiOperations';
import { addEducation, recordCompensation, setExperience } from '../sales/contactProfile';
import { sha256Hex } from '../../domain/shared/hash';

export class EnrichmentError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 404 | 502 = 400) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

/** One role a vendor reported. Dates are ISO day strings or null — vendors are
 *  wildly inconsistent about precision, and inventing a day is worse than none. */
export interface EnrichedRole {
  company: string | null;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  isCurrent: boolean;
}

export interface EnrichedEducation {
  institution: string | null;
  degree: string | null;
  field: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * The ONE shape three vendors are folded onto.
 *
 * A per-vendor payload leaking out of here would put the shape of whichever
 * vendor a workspace happens to have connected into the contact tables, and
 * switching vendors would then silently stop populating half of them.
 */
export interface EnrichedPerson {
  fullName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string | null;
  roles: EnrichedRole[];
  educations: EnrichedEducation[];
  /** Annualised base, when the vendor infers one. Always `inferred` confidence. */
  compensation: { base: number; currency: string; period: string } | null;
}

export interface EnrichmentResult {
  provider: string;
  providerLabel: string;
  /** True when this answer came from `enrichment_cache` and cost nothing. */
  cached: boolean;
  /** Cents this call avoided — the vendor's list price, on a cache hit only. */
  centsAvoided: number;
  person: EnrichedPerson;
  /** What was actually written to the contact tables, so a caller can report it. */
  written: { roles: number; educations: number; compensations: number };
}

export interface EnrichmentDeps {
  db: Db;
  tenantId: number;
  encryptionSecret: string;
  /** Carries the KV binding; absent simply means no read-through caching of the
   *  connection list. The ENRICHMENT cache is in Postgres and always applies. */
  env?: Env;
  fetchImpl?: typeof fetch;
}

/** How long a person enrichment stays fresh. People change jobs, not addresses,
 *  so a month is long enough to matter on the bill and short enough that a title
 *  is not a year stale when it lands on a card. */
const ENRICHMENT_TTL_SECONDS = 30 * 24 * 60 * 60;

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 255) : null;
};

/** A vendor date, reduced to an ISO day or null. Vendors send `2019`, `2019-06`
 *  and full timestamps interchangeably; a bare year becomes January of it. */
function day(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const padded = /^\d{4}$/.test(raw) ? `${raw}-01-01` : /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  const parsed = new Date(padded);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const asDate = (value: string | null): Date | null => (value ? new Date(value) : null);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// ---------------------------------------------------------------------------
// Per-vendor normalization
// ---------------------------------------------------------------------------

/** Clearbit `/v2/people/find`. */
function fromClearbit(body: unknown): EnrichedPerson {
  const person = asJsonRecord(body);
  const employment = asJsonRecord(person.employment);
  const geo = asJsonRecord(person.geo);
  const company = text(employment.name);
  const title = text(employment.title);
  return {
    fullName: text(asJsonRecord(person.name).fullName),
    title,
    company,
    location: text(geo.city) ?? text(geo.country),
    linkedinUrl: text(asJsonRecord(asJsonRecord(person.linkedin).handle)) ?? text(asJsonRecord(person.linkedin).handle),
    // Clearbit reports only the CURRENT role, so that is the only one claimed.
    roles: company || title ? [{ company, title, startedAt: null, endedAt: null, isCurrent: true }] : [],
    educations: [],
    compensation: null,
  };
}

/** People Data Labs `/v5/person/enrich` — the richest of the three. */
function fromPeopleDataLabs(body: unknown): EnrichedPerson {
  const data = asJsonRecord(asJsonRecord(body).data);
  const job = asJsonRecord(data.job_company_name ? data : data);
  const roles = list(data.experience).map((entry): EnrichedRole => {
    const item = asJsonRecord(entry);
    const company = asJsonRecord(item.company);
    const title = asJsonRecord(item.title);
    return {
      company: text(company.name),
      title: text(title.name),
      startedAt: day(item.start_date),
      endedAt: day(item.end_date),
      isCurrent: item.is_primary === true || item.end_date == null,
    };
  });
  const educations = list(data.education).map((entry): EnrichedEducation => {
    const item = asJsonRecord(entry);
    return {
      institution: text(asJsonRecord(item.school).name),
      degree: text(list(item.degrees)[0]),
      field: text(list(item.majors)[0]),
      startedAt: day(item.start_date),
      endedAt: day(item.end_date),
    };
  });
  const salary = Number(data.inferred_salary_max ?? data.inferred_salary ?? NaN);
  return {
    fullName: text(data.full_name),
    title: text(job.job_title),
    company: text(job.job_company_name),
    location: text(data.location_name),
    linkedinUrl: text(data.linkedin_url),
    roles,
    educations,
    compensation: Number.isFinite(salary) && salary > 0
      ? { base: Math.round(salary), currency: 'USD', period: 'year' }
      : null,
  };
}

/** Apollo `/api/v1/people/match`. */
function fromApollo(body: unknown): EnrichedPerson {
  const person = asJsonRecord(asJsonRecord(body).person);
  const organization = asJsonRecord(person.organization);
  const roles = list(person.employment_history).map((entry): EnrichedRole => {
    const item = asJsonRecord(entry);
    return {
      company: text(item.organization_name),
      title: text(item.title),
      startedAt: day(item.start_date),
      endedAt: day(item.end_date),
      isCurrent: item.current === true,
    };
  });
  return {
    fullName: text(person.name),
    title: text(person.title),
    company: text(organization.name),
    location: text(person.city) ?? text(person.country),
    linkedinUrl: text(person.linkedin_url),
    roles,
    educations: [],
    compensation: null,
  };
}

/** Total map — a vendor added to the catalog without a normalizer fails to compile. */
const NORMALIZERS: Record<string, (body: unknown) => EnrichedPerson> = {
  clearbit: fromClearbit,
  people_data_labs: fromPeopleDataLabs,
  apollo: fromApollo,
};

/**
 * An empty answer is not an error — a vendor that has never heard of an address
 * says so with a 200 and a hollow body — but it must not be CACHED as though it
 * were a paid result, or a contact enriched the day before they were indexed
 * stays unknown for the whole TTL.
 */
function isEmpty(person: EnrichedPerson): boolean {
  return !person.fullName && !person.title && !person.company
    && person.roles.length === 0 && person.educations.length === 0 && !person.compensation;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

interface ResolvedVendor {
  credentialId: string;
  provider: string;
  providerLabel: string;
  callCostCents: number;
  credentials: Record<string, unknown>;
}

/**
 * The enrichment vendor this workspace has connected.
 *
 * A workspace connects at most one in practice, so the FIRST enabled one wins
 * rather than making every caller pass an id it does not have. A caller that
 * does care names it.
 */
async function resolveVendor(deps: EnrichmentDeps, preferred?: string): Promise<ResolvedVendor> {
  const wanted = preferred?.trim();
  const rows = await deps.db
    .select({
      id: integrationCredentials.id,
      provider: integrationCredentials.provider,
      name: integrationCredentials.name,
      credentialsEnc: integrationCredentials.credentialsEnc,
      iv: integrationCredentials.iv,
    })
    .from(integrationCredentials)
    .where(and(
      eq(integrationCredentials.tenantId, deps.tenantId),
      eq(integrationCredentials.isEnabled, true),
    ))
    .limit(200);

  const candidates = rows.filter((row) => ENRICHMENT_PROVIDER_IDS.includes(String(row.provider)));
  const row = wanted ? candidates.find((c) => String(c.provider) === wanted) : candidates[0];
  if (!row) {
    throw new EnrichmentError(
      wanted
        ? `"${wanted}" is not connected to this workspace. Connect it in Integrations to enrich contacts with it.`
        : 'No enrichment vendor is connected. Connect Clearbit, People Data Labs or Apollo in Integrations to enrich a contact.',
      404,
    );
  }

  const provider = String(row.provider);
  const spec = enrichmentSpec(provider);
  const descriptor = providerSpec(provider);
  if (!spec || !descriptor) throw new EnrichmentError(`"${provider}" is not an enrichment vendor.`, 400);

  const credentials = await decryptCredentials(row.credentialsEnc, row.iv, deps.encryptionSecret, deps.tenantId);
  if (!credentials) {
    throw new EnrichmentError(`The stored credential for "${row.name}" could not be decrypted.`, 400);
  }
  return {
    credentialId: row.id,
    provider,
    providerLabel: descriptor.label,
    callCostCents: spec.callCostCents,
    credentials,
  };
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The cache key for one lookup.
 *
 * The EMAIL is normalised (lower-cased, trimmed) before hashing, because
 * `Alex@Example.com` and `alex@example.com` are one person and one invoice —
 * keying on the raw string would buy the same record twice and report both as
 * cache misses.
 */
async function requestHash(provider: string, email: string): Promise<string> {
  return sha256Hex(`${provider}|${ENRICHMENT_LOOKUP_OP}|${email.trim().toLowerCase()}`);
}

/**
 * Enrich one contact from the connected vendor, THROUGH the cache.
 *
 * The order is the contract: cache first, credential second, vendor last. A hit
 * never decrypts a credential and never leaves the building, which is what makes
 * `cacheSavings` an honest number rather than an estimate.
 */
export async function enrichContact(
  deps: EnrichmentDeps,
  input: { contactRef: string; email: string; provider?: string },
): Promise<EnrichmentResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new EnrichmentError('Provide the email address to enrich this contact from.');
  }
  const contactRef = String(input.contactRef ?? '').trim();
  if (!contactRef) throw new EnrichmentError('contactRef is required.');

  const vendor = await resolveVendor(deps, input.provider);
  const hash = await requestHash(vendor.provider, email);

  // (1) THE CACHE, BEFORE ANYTHING IS SPENT. `cacheLookup` counts the hit itself,
  //     applies expiry in the query, and is tenant-scoped through the nullable
  //     helper — see aiOperations for why each of those is not the caller's job.
  const hit = await cacheLookup(deps.db, deps.tenantId, vendor.provider, hash);
  if (hit) {
    const person = NORMALIZERS[vendor.provider]!(hit.payload);
    return {
      provider: vendor.provider,
      providerLabel: vendor.providerLabel,
      cached: true,
      centsAvoided: vendor.callCostCents,
      person,
      written: await writeProfile(deps, contactRef, person),
    };
  }

  // (2) THE PAID CALL. Routed through the SAME `callProvider` the connectivity
  //     test uses, so a vendor that tests green cannot fail here for auth reasons.
  const result = await callProvider(
    vendor.provider,
    ENRICHMENT_LOOKUP_OP,
    vendor.credentials,
    { email },
    deps.fetchImpl ?? fetch,
  );
  if (!result.ok) {
    // 402 is the vendor's own out-of-credit answer and the one refusal an operator
    // can act on, so it survives as itself rather than collapsing into a 502.
    const status = result.status === 402 ? 402 : 502;
    throw new EnrichmentError(
      result.error ?? `${vendor.providerLabel} rejected the lookup (HTTP ${result.status}).`,
      status,
    );
  }

  const person = NORMALIZERS[vendor.provider]!(result.body);

  // (3) STORE — but only a real answer. See {@link isEmpty}.
  if (!isEmpty(person)) {
    await cacheStore(deps.db, deps.tenantId, {
      provider: vendor.provider,
      requestHash: hash,
      payload: result.body,
      costCentsAvoided: vendor.callCostCents,
      ttlSeconds: ENRICHMENT_TTL_SECONDS,
    });
  }

  return {
    provider: vendor.provider,
    providerLabel: vendor.providerLabel,
    cached: false,
    centsAvoided: 0,
    person,
    written: await writeProfile(deps, contactRef, person),
  };
}

/**
 * Write what the vendor said into the contact tables it belongs in.
 *
 * ALWAYS `confidence: 'inferred'`. Roles are written newest-first so the current
 * one lands last and its `isCurrent` clear-then-set is the final word — writing
 * them in vendor order let a stale role clear the current one it had just set.
 */
async function writeProfile(
  deps: EnrichmentDeps,
  contactRef: string,
  person: EnrichedPerson,
): Promise<EnrichmentResult['written']> {
  const roles = [...person.roles].sort((a, b) => Number(a.isCurrent) - Number(b.isCurrent));
  let written = 0;
  for (const role of roles) {
    if (!role.company && !role.title) continue;
    await setExperience(deps.db, deps.tenantId, contactRef, {
      company: role.company,
      title: role.title,
      startedAt: asDate(role.startedAt),
      endedAt: asDate(role.endedAt),
      // A current role may not carry an end date — the service rejects the
      // contradiction rather than storing it, so it is resolved here instead of
      // handing it a body it will refuse.
      isCurrent: role.isCurrent && !role.endedAt,
      location: person.location,
    });
    written += 1;
  }

  let educations = 0;
  for (const education of person.educations) {
    if (!education.institution) continue;
    await addEducation(deps.db, deps.tenantId, contactRef, {
      institution: education.institution,
      degree: education.degree,
      field: education.field,
      startedAt: asDate(education.startedAt),
      endedAt: asDate(education.endedAt),
    });
    educations += 1;
  }

  let compensations = 0;
  if (person.compensation) {
    await recordCompensation(deps.db, deps.tenantId, contactRef, {
      base: person.compensation.base,
      currency: person.compensation.currency,
      period: person.compensation.period,
      // Never `verified`. See the module docstring.
      confidence: 'inferred',
    });
    compensations = 1;
  }

  return { roles: written, educations, compensations };
}

/**
 * Money this workspace did not spend on enrichment.
 *
 * A thin pass-through on purpose: `cacheSavings` is the read and it belongs to
 * the table's owner. What this adds is the ONE thing the generic read cannot
 * know — the vendor's human label — so the answer names "Clearbit" rather than
 * a provider slug on a finance card.
 */
export async function enrichmentSavings(db: Db, tenantId: number) {
  const rows = await cacheSavings(db, tenantId);
  return rows
    .filter((row) => ENRICHMENT_PROVIDER_IDS.includes(row.provider))
    .map((row) => ({ ...row, providerLabel: providerSpec(row.provider)?.label ?? row.provider }));
}
