/**
 * A PAYEE'S TAX PROFILE — the W-9/W-8 facts, and the vault the tax ID goes into.
 *
 * One module, one reason to change: everything about how a person's tax identity
 * is stored and read back. The year-end REPORT is a separate module that consumes
 * this one (`taxReport.ts`); it does not share a file, because "collect a form"
 * and "produce a filing" change for different reasons.
 *
 * ── WHERE THE FACTS LIVE ────────────────────────────────────────────────────
 * The profile is a `party_roles` row with `role = 'payee'`. It is NOT a new
 * table: a tax profile is a set of facts about a person HOLDING the payee role,
 * which is precisely what that primitive already models — and its existing
 * `uq_party_roles_role` index already enforces "one tax profile per person per
 * workspace" without any DDL of ours. The non-secret W-9 fields live in `attrs`.
 *
 * ── WHERE THE TAX ID LIVES, AND WHY NOT HERE ────────────────────────────────
 * A tax ID is the worst possible fact to store twice, so it never touches the
 * profile row. It is a `credentials` row — the one encrypted store — sealed by
 * the same per-tenant AES-256-GCM `credentialCrypto` every connection uses, with
 * `purpose = 'tax_id'` and `subjectRef = <userId>`. Two things follow for free:
 * the hot profile read never pulls ciphertext into memory, and a dump of
 * `party_roles` is not a breach.
 *
 * ── THE ONE-WAY DOOR ────────────────────────────────────────────────────────
 * Nothing in this module returns a decrypted tax ID, and there is deliberately
 * no function that could. The profile carries `taxIdLast4`, which is what a form
 * echoes back and what a 1099 filer matches on; the full value is written once
 * and read by nothing. If a future filing integration genuinely needs to transmit
 * it, that is a new, separately-audited export path — not a getter added here.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { credentials, partyRoles } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { credentialSecret, encryptCredentials } from '../integrations/credentialCrypto';
import { ENTITY_TYPES, formTypeFor, recipientTypeFor, taxIdLast4, type RecipientType } from '../../domain/finance/taxThreshold';

/** The `party_roles.role` value carrying a tax profile. */
export const PAYEE_ROLE = 'payee';

/** The `credentials.purpose` value a sealed tax ID is stored under. */
export const TAX_ID_PURPOSE = 'tax_id';

/** The tax-id kinds a profile may declare. `ssn`/`ein` are US; `foreign` is any other. */
export const TAX_ID_TYPES = ['ssn', 'ein', 'itin', 'foreign'] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];

/** The non-secret W-9/W-8 facts, exactly as they sit in `party_roles.attrs`. */
export interface TaxProfileAttrs {
  entityType: string | null;
  legalName: string | null;
  businessName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  taxResidencyCountry: string | null;
  taxIdType: TaxIdType | null;
  /** The ONLY part of the tax id this module ever returns. */
  taxIdLast4: string | null;
  formSubmittedAt: string | null;
}

/** A profile as any reader sees it — derived fields included, secret excluded. */
export interface TaxProfile extends TaxProfileAttrs {
  userId: string;
  /** How this recipient files, derived from `entityType`. Never stored. */
  recipientType: RecipientType;
  /** Which form their residency puts them on. Never stored. */
  formType: '1099-NEC' | '1042-S';
  /** True once a tax id has actually been sealed for this person. */
  hasTaxId: boolean;
  /** Everything a filing needs is present — the UI's "ready" state. */
  complete: boolean;
}

export interface TaxProfileInput {
  entityType?: string | null;
  legalName?: string | null;
  businessName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  taxResidencyCountry?: string | null;
  taxIdType?: string | null;
  /** Write-only. Sealed on arrival; only its last four survive on the profile. */
  taxId?: string | null;
}

const cacheKey = (tenantId: number, userId: string) => `tax:profile:${tenantId}:${userId}`;

/** Trim to a bounded string, or null. Every text field goes through this. */
function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === '' ? null : trimmed;
}

/** Normalise a country to an uppercase ISO-ish code, or null. */
function country(value: unknown): string | null {
  const raw = text(value, 2 + 1);
  return raw ? raw.toUpperCase().slice(0, 2) : null;
}

/** Empty attrs — the shape a person with no profile yet reads as. */
function emptyAttrs(): TaxProfileAttrs {
  return {
    entityType: null, legalName: null, businessName: null,
    addressLine1: null, addressLine2: null, addressCity: null,
    addressRegion: null, addressPostalCode: null, addressCountry: null,
    taxResidencyCountry: null, taxIdType: null, taxIdLast4: null,
    formSubmittedAt: null,
  };
}

/** Read stored `attrs` back into the typed shape, ignoring anything foreign. */
export function parseTaxProfileAttrs(attrs: unknown): TaxProfileAttrs {
  const a = (attrs ?? {}) as Record<string, unknown>;
  const idType = text(a.taxIdType);
  return {
    entityType:          text(a.entityType, 40),
    legalName:           text(a.legalName),
    businessName:        text(a.businessName),
    addressLine1:        text(a.addressLine1),
    addressLine2:        text(a.addressLine2),
    addressCity:         text(a.addressCity, 100),
    addressRegion:       text(a.addressRegion, 100),
    addressPostalCode:   text(a.addressPostalCode, 20),
    addressCountry:      country(a.addressCountry),
    taxResidencyCountry: country(a.taxResidencyCountry),
    taxIdType:           (TAX_ID_TYPES as readonly string[]).includes(idType ?? '') ? (idType as TaxIdType) : null,
    taxIdLast4:          text(a.taxIdLast4, 4),
    formSubmittedAt:     text(a.formSubmittedAt, 40),
  };
}

/**
 * A profile is filing-ready when the filer has a name, an address and an id.
 * The rule is here rather than in the UI because the REPORT needs the same
 * answer, and two copies of it would eventually disagree about a payee.
 */
function isComplete(attrs: TaxProfileAttrs, hasTaxId: boolean): boolean {
  return Boolean(
    attrs.entityType &&
    attrs.legalName &&
    attrs.addressLine1 &&
    attrs.addressCity &&
    attrs.addressCountry &&
    attrs.taxResidencyCountry &&
    hasTaxId,
  );
}

/** Present stored attrs + vault state as the profile every reader sees. */
export function toTaxProfile(userId: string, attrs: TaxProfileAttrs, hasTaxId: boolean): TaxProfile {
  return {
    ...attrs,
    userId,
    recipientType: recipientTypeFor(attrs.entityType),
    formType: formTypeFor(attrs.taxResidencyCountry),
    hasTaxId,
    complete: isComplete(attrs, hasTaxId),
  };
}

/** The entity types and id types a form offers. Data, so the UI adds no copy. */
export function taxProfileOptions(): { entityTypes: string[]; taxIdTypes: readonly string[] } {
  return { entityTypes: ENTITY_TYPES, taxIdTypes: TAX_ID_TYPES };
}

/** Read one person's tax profile. Cached — the payout UI reads it on every view. */
export async function getTaxProfile(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  userId: string,
): Promise<TaxProfile> {
  return getOrSetCached(env, cacheKey(tenantId, userId), async () => {
    const [role] = await db
      .select({ attrs: partyRoles.attrs })
      .from(partyRoles)
      .where(scopedToTenant(partyRoles, tenantId,
        eq(partyRoles.partyKind, 'person'),
        eq(partyRoles.partyRef, userId),
        eq(partyRoles.role, PAYEE_ROLE),
      ))
      .limit(1);

    const attrs = parseTaxProfileAttrs(role?.attrs);
    // `hasTaxId` is answered by the presence of the sealed row, never by
    // decrypting it — the vault is write-only from this module's side.
    const [sealed] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(scopedToTenant(credentials, tenantId,
        eq(credentials.subjectRef, userId),
        eq(credentials.purpose, TAX_ID_PURPOSE),
      ))
      .limit(1);

    return toTaxProfile(userId, attrs, Boolean(sealed));
  }, { kvTtlSeconds: 300 });
}

/**
 * Create or update a person's tax profile, sealing the tax id if one was sent.
 *
 * Merges: a caller may PATCH one field without resubmitting the whole W-9, and
 * omitting `taxId` leaves any previously sealed id untouched. Sending an empty
 * string for a text field clears it; that is the difference between `undefined`
 * (not mentioned) and `null`/`''` (deliberately blank).
 */
export async function saveTaxProfile(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  input: TaxProfileInput,
): Promise<TaxProfile> {
  const current = await getTaxProfile(db, env, tenantId, userId);
  const merged: TaxProfileAttrs = { ...current };

  const assign = <K extends keyof TaxProfileAttrs>(key: K, raw: unknown, normalise: (v: unknown) => TaxProfileAttrs[K]) => {
    if (raw !== undefined) merged[key] = normalise(raw);
  };

  assign('entityType',          input.entityType,          (v) => text(v, 40));
  assign('legalName',           input.legalName,           (v) => text(v));
  assign('businessName',        input.businessName,        (v) => text(v));
  assign('addressLine1',        input.addressLine1,        (v) => text(v));
  assign('addressLine2',        input.addressLine2,        (v) => text(v));
  assign('addressCity',         input.addressCity,         (v) => text(v, 100));
  assign('addressRegion',       input.addressRegion,       (v) => text(v, 100));
  assign('addressPostalCode',   input.addressPostalCode,   (v) => text(v, 20));
  assign('addressCountry',      input.addressCountry,      (v) => country(v));
  assign('taxResidencyCountry', input.taxResidencyCountry, (v) => country(v));
  assign('taxIdType',           input.taxIdType,           (v) => {
    const t = text(v);
    return (TAX_ID_TYPES as readonly string[]).includes(t ?? '') ? (t as TaxIdType) : null;
  });

  const rawTaxId = typeof input.taxId === 'string' ? input.taxId.trim() : '';
  if (rawTaxId) {
    await sealTaxId(db, env, tenantId, userId, rawTaxId);
    merged.taxIdLast4 = taxIdLast4(rawTaxId);
  }

  const hasTaxId = current.hasTaxId || Boolean(rawTaxId);
  if (isComplete(merged, hasTaxId) && !merged.formSubmittedAt) {
    merged.formSubmittedAt = new Date().toISOString();
  }

  const now = new Date();
  await db.insert(partyRoles)
    .values({
      tenantId, partyKind: 'person', partyRef: userId, role: PAYEE_ROLE,
      status: 'active', attrs: merged, startedAt: now, updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role],
      set: { attrs: merged, status: 'active', updatedAt: now },
    });

  await invalidateTaxProfile(env, tenantId, userId);
  return toTaxProfile(userId, merged, hasTaxId);
}

/**
 * Seal a tax id into `credentials`. Write-only by construction.
 *
 * The upsert targets `uq_credentials_subject_purpose` — the partial unique index
 * migration 1117 added specifically because the pre-existing
 * `uq_credentials_purpose` is over the NULLABLE `connection_id` and therefore
 * constrained nothing on the connection-less side. Without it a resubmitted W-9
 * would insert a SECOND sealed id and later reads would pick one arbitrarily.
 */
async function sealTaxId(db: Db, env: Env, tenantId: number, userId: string, taxId: string): Promise<void> {
  const { enc, iv } = await encryptCredentials({ taxId }, credentialSecret(env), tenantId);
  const now = new Date();
  await db.insert(credentials)
    .values({
      tenantId, connectionId: null, subjectRef: userId, purpose: TAX_ID_PURPOSE,
      secretEnc: enc, secretIv: iv, status: 'active', rotatedAt: now, updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [credentials.tenantId, credentials.subjectRef, credentials.purpose],
      // Must restate the INDEX's predicate verbatim: Postgres matches a partial
      // unique index by its WHERE clause, and an ON CONFLICT that omits it does
      // not resolve to this index at all — it raises "no unique or exclusion
      // constraint matching the ON CONFLICT specification" at runtime.
      targetWhere: sql`connection_id IS NULL AND subject_ref IS NOT NULL`,
      set: { secretEnc: enc, secretIv: iv, status: 'active', rotatedAt: now, updatedAt: now },
    });
}

/** Drop the cached profile. Exported so the report path can invalidate too. */
export async function invalidateTaxProfile(env: Env, tenantId: number, userId: string): Promise<void> {
  await invalidateCached(env, cacheKey(tenantId, userId));
}

/**
 * Load many payees' profiles in ONE query, keyed by user id.
 *
 * The report needs every recipient's facts at once; asking `getTaxProfile` per
 * recipient would be the N+1 this codebase treats as a defect. `hasTaxId` comes
 * from a second single query rather than a join so neither statement fans out.
 */
export async function getTaxProfilesFor(
  db: Db,
  tenantId: number,
  userIds: string[],
): Promise<Map<string, TaxProfile>> {
  const out = new Map<string, TaxProfile>();
  if (userIds.length === 0) return out;

  const [roles, sealed] = await Promise.all([
    db.select({ partyRef: partyRoles.partyRef, attrs: partyRoles.attrs })
      .from(partyRoles)
      .where(scopedToTenant(partyRoles, tenantId,
        eq(partyRoles.partyKind, 'person'),
        eq(partyRoles.role, PAYEE_ROLE),
        inArray(partyRoles.partyRef, userIds),
      )),
    db.select({ subjectRef: credentials.subjectRef })
      .from(credentials)
      .where(scopedToTenant(credentials, tenantId,
        eq(credentials.purpose, TAX_ID_PURPOSE),
        inArray(credentials.subjectRef, userIds),
      )),
  ]);

  const withId = new Set(sealed.map((s) => s.subjectRef).filter((s): s is string => Boolean(s)));
  const attrsByUser = new Map(roles.map((r) => [r.partyRef, parseTaxProfileAttrs(r.attrs)]));

  for (const userId of userIds) {
    out.set(userId, toTaxProfile(userId, attrsByUser.get(userId) ?? emptyAttrs(), withId.has(userId)));
  }
  return out;
}
