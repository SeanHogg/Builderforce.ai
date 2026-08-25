import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Terms-of-service acceptance — the ONE place that answers "must this user accept
 * new terms before we serve them?".
 *
 * Three middlewares run this on EVERY authenticated request (`authMiddleware`,
 * `webAuthMiddleware`, `superAdminMiddleware`), so it sits squarely on the hot
 * path. Both inputs are slow-changing:
 *
 *   - the ACTIVE terms version changes only when an admin publishes/amends the
 *     document (a handful of times per year), and is the same for everyone;
 *   - a user's ACCEPTED version changes exactly once per acceptance.
 *
 * Recomputing both from Postgres per request was two neon-http round-trips on
 * every call, so each is served through the canonical read-through cache and
 * invalidated by its writer ({@link invalidateActiveTermsVersion} from the legal
 * publish/amend paths, {@link invalidateAcceptedTermsVersion} from the accept
 * path). A cache miss costs exactly what the old code cost every time.
 *
 * Lives in `application/` (not `presentation/middleware/`, where it used to) so
 * that application callers — `demoSeedService`, `legalDocsService` — no longer
 * import upward into the presentation layer.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { legalDocumentAcceptances, legalDocuments, userLegalAcceptances, userTermsAgreements } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/** Cache key for the platform-wide active terms version. */
// Bump the key with each migration-published legal release. SQL migrations cannot
// invalidate Cloudflare KV, so changing the namespace prevents a deploy from
// serving the cached 1.0.0 version for up to an hour after 2.0.0 is published.
const ACTIVE_TERMS_KEY = 'terms:active-version:v2';

/** Cache key for one user's accepted terms version. */
const acceptedTermsKey = (userId: string): string => `terms:accepted:${userId}`;

/**
 * The active terms version is read by every request but written a few times a
 * year, so it is worth a long TTL; the publish/amend paths invalidate explicitly.
 */
const ACTIVE_TTL_SECONDS = 3_600;
const ACCEPTED_TTL_SECONDS = 3_600;

/** Wrapper so a `null` (no active terms doc) survives the cache, which treats a
 *  bare null as a miss and would re-query on every request. */
type VersionBox = { version: string | null };

async function loadActiveTermsVersion(db: Db): Promise<string | null> {
  const [doc] = await db
    .select({ version: legalDocuments.version })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.documentType, 'terms'),
        eq(legalDocuments.isActive, true),
      ),
    )
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  return doc?.version ?? null;
}

async function loadAcceptedTermsVersion(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ version: userLegalAcceptances.version })
    .from(userLegalAcceptances)
    .where(
      and(
        eq(userLegalAcceptances.userId, userId),
        eq(userLegalAcceptances.documentType, 'terms'),
      ),
    )
    .limit(1);

  return row?.version ?? null;
}

/**
 * The currently-published terms version, or null when the platform has none.
 * Pass `env` to serve from cache; omit it (tests, one-off scripts) to always read
 * through to the database.
 */
export async function getActiveTermsVersion(db: Db, env?: Env): Promise<string | null> {
  if (!env) return loadActiveTermsVersion(db);
  const box = await getOrSetCached<VersionBox>(
    env,
    ACTIVE_TERMS_KEY,
    async () => ({ version: await loadActiveTermsVersion(db) }),
    { kvTtlSeconds: ACTIVE_TTL_SECONDS },
  );
  return box.version;
}

/** The terms version this user has accepted, or null. */
export async function getAcceptedTermsVersion(db: Db, userId: string, env?: Env): Promise<string | null> {
  if (!env) return loadAcceptedTermsVersion(db, userId);
  const box = await getOrSetCached<VersionBox>(
    env,
    acceptedTermsKey(userId),
    async () => ({ version: await loadAcceptedTermsVersion(db, userId) }),
    { kvTtlSeconds: ACCEPTED_TTL_SECONDS },
  );
  return box.version;
}

export interface TermsAcceptanceStatus {
  requiredVersion: string | null;
  acceptedVersion: string | null;
  needsAcceptance: boolean;
}

/**
 * Does `userId` need to accept the current terms? Both lookups are cached when
 * `env` is supplied, and the accepted-version read is skipped entirely when the
 * platform has no active terms document.
 */
export async function checkTermsAcceptance(
  db: Db,
  userId: string,
  env?: Env,
): Promise<TermsAcceptanceStatus> {
  const requiredVersion = await getActiveTermsVersion(db, env);
  if (!requiredVersion) {
    return { requiredVersion: null, acceptedVersion: null, needsAcceptance: false };
  }

  const acceptedVersion = await getAcceptedTermsVersion(db, userId, env);
  return { requiredVersion, acceptedVersion, needsAcceptance: acceptedVersion !== requiredVersion };
}

/** Call after publishing or amending a legal document. Best-effort. */
export async function invalidateActiveTermsVersion(env: Env | undefined): Promise<void> {
  if (!env) return;
  await invalidateCached(env, ACTIVE_TERMS_KEY).catch((error) => {
    reportCaughtError(error, { source: "application/legal/termsAcceptance.ts", operation: "invalidateActiveTermsVersion" });
  });
}

/** Call after a user accepts terms. Best-effort. */
export async function invalidateAcceptedTermsVersion(env: Env | undefined, userId: string): Promise<void> {
  if (!env) return;
  await invalidateCached(env, acceptedTermsKey(userId)).catch((error) => {
    reportCaughtError(error, { source: "application/legal/termsAcceptance.ts", operation: "invalidateAcceptedTermsVersion" });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PRD 19 §9 — the evidentiary trail and the organisation binding.
//
// ── WHAT WAS MISSING, AND WHY IT IS ADDED HERE RATHER THAN BESIDE ───────────
// Everything above is the GATE, and the gate is the mature side: cached, on the
// hot path of three middlewares, and answering one question fast — "must this
// user accept before we serve them?". It stays exactly as it is.
//
// What it cannot do is survive an audit. `user_legal_acceptances` is keyed
// `(user_id, document_type)`, so accepting v2 OVERWRITES the row that said the
// user accepted v1: there is no history, no record of what the document SAID at
// the time, and no evidence of who clicked from where. And it has no notion of a
// company agreeing — only of a person clicking.
//
// BurnRateOS's `terms` module had the second half (status, agree, accept-all) but
// on a single flat table that conflated the person with the organisation.
// Builderforce already had schema for both halves done properly and no reader for
// either. So this is the missing capability added to the EXISTING owner:
//
//   `legal_document_acceptances`  the person's act, as EVIDENCE — the document
//                                 hash as published, the IP, the user agent, and
//                                 `superseded_at` instead of an in-place update.
//                                 Append-only, so the trail can be replayed.
//   `user_terms_agreements`       the ORGANISATION's binding — signatory title
//                                 and legal entity name, which is what makes a
//                                 DPA enforceable against a company rather than
//                                 against whoever happened to click.
//
// One feature, two halves, one file. A separate service would have meant two
// places that both believe they know whether terms are accepted.
//
// ── THE GATE ROW AND THE EVIDENCE ROW ARE WRITTEN TOGETHER ──────────────────
// {@link recordAcceptance} does both writes and the cache invalidation. The
// alternative — leaving the caller to write the fast row and remember the
// evidence row — is how the two drift, and a trail that is missing exactly the
// acceptances someone later disputes is worse than no trail.

/** The vocabulary `legal_document_acceptances.document_kind` documents. A const
 *  rather than a free string, so a typo becomes a rejection instead of a document
 *  nobody is ever prompted to accept. */
export const DOCUMENT_KINDS = ['terms', 'privacy', 'dpa', 'aup', 'nda', 'cookie'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const isDocumentKind = (v: unknown): v is DocumentKind =>
  typeof v === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(v);

export class TermsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'TermsError';
  }
}

const requireVersion = (v: string): string => {
  const s = v.trim();
  if (!s || s.length > 32) throw new TermsError('version is required and must be 32 characters or fewer');
  return s;
};

const requireRef = (v: string, what: string): string => {
  const s = v.trim();
  if (!s || s.length > 64) throw new TermsError(`${what} is required and must be 64 characters or fewer`);
  return s;
};

export type AcceptanceEvidence = {
  documentHash?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  email?: string | null;
  tenantId?: number | null;
};

/**
 * Accept a document: the gate row, the evidence row and the cache, in one call.
 *
 * The gate row is an UPSERT because the gate only ever asks "what is current".
 * The evidence row is `onConflictDoNothing` because it is append-only and a
 * double-submitted consent form is the same agreement, not a second one — the
 * unique index on (party, kind, version) is what makes that true rather than a
 * read-then-write race.
 *
 * Cache invalidation is LAST and is not optional: the auth middlewares serve the
 * accepted version from KV, so an accept that does not invalidate leaves the user
 * gated with a 428 on the one screen meant to unblock them.
 */
export async function recordAcceptance(
  db: Db,
  env: Env | undefined,
  userId: string,
  kind: DocumentKind,
  version: string,
  evidence: AcceptanceEvidence = {},
): Promise<{ kind: DocumentKind; version: string; acceptedAt: Date }> {
  if (!isDocumentKind(kind)) throw new TermsError(`unknown document kind '${String(kind)}'`);
  const v = requireVersion(version);
  const party = requireRef(userId, 'userId');

  // The gate's fast row. `document_type` is a pg enum, so only the kinds it
  // declares can be written here — a kind outside it is evidence-only, which is
  // correct: the gate exists for the documents that BLOCK a session.
  if (kind === 'terms' || kind === 'privacy') {
    await db
      .insert(userLegalAcceptances)
      .values({ userId: party, documentType: kind, version: v })
      .onConflictDoUpdate({
        target: [userLegalAcceptances.userId, userLegalAcceptances.documentType],
        set: { version: v, acceptedAt: sql`now()`, updatedAt: sql`now()` },
      });
  }

  // The evidence row. Append-only: a later version supersedes this one rather
  // than replacing it, so the trail shows what was agreed and when.
  await db
    .insert(legalDocumentAcceptances)
    .values({
      tenantId: evidence.tenantId ?? null,
      documentKind: kind,
      documentVersion: v,
      documentHash: evidence.documentHash ?? null,
      partyKind: 'user',
      partyRef: party,
      email: evidence.email ?? null,
      ipAddress: evidence.ipAddress ?? null,
      userAgent: evidence.userAgent ?? null,
    })
    .onConflictDoNothing({
      target: [
        legalDocumentAcceptances.partyKind,
        legalDocumentAcceptances.partyRef,
        legalDocumentAcceptances.documentKind,
        legalDocumentAcceptances.documentVersion,
      ],
    });

  await invalidateAcceptedTermsVersion(env, party);
  return { kind, version: v, acceptedAt: new Date() };
}

/** Every acceptance this person has standing, newest first. Superseded rows are
 *  excluded because the question a consent gate asks is "what is agreed NOW";
 *  {@link acceptanceHistory} is the one that answers "what was ever agreed". */
export async function currentAcceptances(db: Db, userId: string) {
  return db
    .select({
      documentKind: legalDocumentAcceptances.documentKind,
      documentVersion: legalDocumentAcceptances.documentVersion,
      acceptedAt: legalDocumentAcceptances.acceptedAt,
    })
    .from(legalDocumentAcceptances)
    .where(acrossTenants(legalDocumentAcceptances, 'subject_own_rows',
      eq(legalDocumentAcceptances.partyKind, 'user'),
      eq(legalDocumentAcceptances.partyRef, requireRef(userId, 'userId')),
      isNull(legalDocumentAcceptances.supersededAt),
    ))
    .orderBy(desc(legalDocumentAcceptances.acceptedAt));
}

/** The full trail, superseded rows included — what this person agreed to, in what
 *  order, from where. This is the read a dispute actually needs. */
export async function acceptanceHistory(db: Db, userId: string) {
  return db
    .select()
    .from(legalDocumentAcceptances)
    .where(acrossTenants(legalDocumentAcceptances, 'subject_own_rows',
      eq(legalDocumentAcceptances.partyKind, 'user'),
      eq(legalDocumentAcceptances.partyRef, requireRef(userId, 'userId')),
    ))
    .orderBy(desc(legalDocumentAcceptances.acceptedAt));
}

/**
 * What this person still owes, given the kinds the caller says are required.
 *
 * The required list is an ARGUMENT, not a constant: which documents gate which
 * surface is a product decision that differs between signup, an enterprise DPA
 * and an embed, and baking one list in here would make all three the same gate.
 */
export async function outstandingFor(
  db: Db,
  userId: string,
  required: readonly DocumentKind[],
): Promise<{ outstanding: DocumentKind[]; accepted: { documentKind: string; documentVersion: string }[] }> {
  if (required.length === 0) return { outstanding: [], accepted: [] };
  const accepted = await db
    .select({
      documentKind: legalDocumentAcceptances.documentKind,
      documentVersion: legalDocumentAcceptances.documentVersion,
    })
    .from(legalDocumentAcceptances)
    .where(acrossTenants(legalDocumentAcceptances, 'subject_own_rows',
      eq(legalDocumentAcceptances.partyKind, 'user'),
      eq(legalDocumentAcceptances.partyRef, requireRef(userId, 'userId')),
      isNull(legalDocumentAcceptances.supersededAt),
      inArray(legalDocumentAcceptances.documentKind, [...required]),
    ));
  const have = new Set(accepted.map((a) => a.documentKind));
  return { outstanding: required.filter((k) => !have.has(k)), accepted };
}

/**
 * Publish a version: every earlier acceptance of that kind is superseded in ONE
 * statement.
 *
 * This is what makes "outstanding" a FACT in the table rather than a comparison
 * the caller has to get right. A comparison changes retroactively the moment a
 * version is published and leaves no row saying that it did; a stamped
 * `superseded_at` can be replayed. The write is scoped by kind and not by party
 * for the same reason — publishing affects everyone at once, and a per-party loop
 * leaves the population half-migrated for as long as it runs.
 */
export async function supersedeEarlierVersions(
  db: Db,
  env: Env | undefined,
  kind: DocumentKind,
  version: string,
): Promise<{ acceptances: number; bindings: number }> {
  if (!isDocumentKind(kind)) throw new TermsError(`unknown document kind '${String(kind)}'`);
  const v = requireVersion(version);

  // Deliberately platform-wide, and that IS the semantics: a published version
  // re-gates every workspace at once. A per-tenant loop would leave the platform
  // half-superseded for as long as it ran, with no row saying which half.
  const acceptances = await db
    .update(legalDocumentAcceptances)
    .set({ supersededAt: new Date() })
    .where(acrossTenants(legalDocumentAcceptances, 'global_uniqueness',
      eq(legalDocumentAcceptances.documentKind, kind),
      sql`${legalDocumentAcceptances.documentVersion} <> ${v}`,
      isNull(legalDocumentAcceptances.supersededAt),
    ))
    .returning({ id: legalDocumentAcceptances.id });

  const bindings = await db
    .update(userTermsAgreements)
    .set({ supersededAt: new Date() })
    .where(acrossTenants(userTermsAgreements, 'global_uniqueness',
      eq(userTermsAgreements.documentKind, kind),
      sql`${userTermsAgreements.documentVersion} <> ${v}`,
      isNull(userTermsAgreements.supersededAt),
    ))
    .returning({ id: userTermsAgreements.id });

  await invalidateActiveTermsVersion(env);
  return { acceptances: acceptances.length, bindings: bindings.length };
}

// ── The organisation's binding ──────────────────────────────────────────────

export type OrgBindInput = {
  kind: DocumentKind;
  version: string;
  signatoryRef: string;
  signatoryTitle?: string | null;
  legalEntityName?: string | null;
};

/**
 * Bind the TENANT to a document version, naming the human who signed for it.
 *
 * Not a wrapper around {@link recordAcceptance} and deliberately not merged with
 * it: an organisation binding carries a signatory TITLE and a legal entity name,
 * and its unique index is per TENANT rather than per person — one company agrees
 * once, however many of its people clicked. Collapsing the two is precisely the
 * conflation that made BurnRateOS's single table unable to answer either question
 * properly.
 */
export async function bindOrganisation(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: OrgBindInput,
) {
  if (!isDocumentKind(input.kind)) throw new TermsError(`unknown document kind '${String(input.kind)}'`);
  const version = requireVersion(input.version);
  const signatoryRef = requireRef(input.signatoryRef, 'signatoryRef');

  await db
    .insert(userTermsAgreements)
    .values({
      tenantId,
      signatoryRef,
      documentKind: input.kind,
      documentVersion: version,
      signatoryTitle: input.signatoryTitle ?? null,
      legalEntityName: input.legalEntityName ?? null,
    })
    .onConflictDoNothing({
      target: [
        userTermsAgreements.tenantId,
        userTermsAgreements.documentKind,
        userTermsAgreements.documentVersion,
      ],
    });

  const [row] = await db
    .select()
    .from(userTermsAgreements)
    .where(scopedToTenant(userTermsAgreements, tenantId, and(
      eq(userTermsAgreements.documentKind, input.kind),
      eq(userTermsAgreements.documentVersion, version),
    )))
    .limit(1);
  if (!row) throw new TermsError('could not record the organisation binding');

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'terms.organisation_bound',
    targetType: 'terms_agreement',
    targetId: String(row.id),
    metadata: { kind: input.kind, version, legalEntityName: input.legalEntityName ?? null },
  });
  return row;
}

/** What this workspace is currently bound to, and who signed. */
export async function organisationBindings(db: Db, tenantId: number) {
  return db
    .select()
    .from(userTermsAgreements)
    .where(scopedToTenant(userTermsAgreements, tenantId, isNull(userTermsAgreements.supersededAt)))
    .orderBy(desc(userTermsAgreements.agreedAt));
}

/**
 * The whole compliance answer for one workspace.
 *
 * Returns the organisation's standing bindings AND how many distinct people have
 * accepted each kind, because "the company signed" and "the staff have read it"
 * are different questions — and a consent dashboard that shows only the first is
 * how an unread policy passes an audit.
 */
export async function tenantComplianceSummary(db: Db, tenantId: number) {
  const bindings = await organisationBindings(db, tenantId);
  const acceptancesByKind = await db
    .select({
      documentKind: legalDocumentAcceptances.documentKind,
      documentVersion: legalDocumentAcceptances.documentVersion,
      people: sql<number>`count(distinct ${legalDocumentAcceptances.partyRef})::int`,
    })
    .from(legalDocumentAcceptances)
    .where(scopedToNullableTenant(
      legalDocumentAcceptances,
      tenantId,
      isNull(legalDocumentAcceptances.supersededAt),
    ))
    .groupBy(legalDocumentAcceptances.documentKind, legalDocumentAcceptances.documentVersion);

  return { bindings, acceptancesByKind };
}
