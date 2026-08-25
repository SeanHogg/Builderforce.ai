/**
 * The depth behind a contact — roles held, education, compensation, saved
 * searches (PRD 19 §9).
 *
 * ── WHY THESE ARE TABLES AND NOT JSON ON THE CONTACT ────────────────────────
 * `contact_experiences`' own docstring gives the reason and this module is built
 * to honour it: every one of them is "filtered and aggregated independently —
 * *everyone who worked at X*, *median comp for role Y*". Those are the two reads
 * that pay for the tables, so they are the two reads implemented here
 * ({@link alumniOf}, {@link compensationBenchmark}). A profile service that only
 * did per-contact CRUD would have left the tables costing what a JSON column
 * costs and buying nothing.
 *
 * ── THE MERGE ───────────────────────────────────────────────────────────────
 * Builderforce owns `contacts` and reaches it through `SalesWorkspaceService`;
 * what it had no reader for was the enrichment depth around it. BurnRateOS's
 * `contacts` module wrote all four shapes. So this adds the depth to the existing
 * owner rather than standing up a second contact system — `contacts` itself is
 * untouched.
 *
 * ── CONFIDENCE IS NOT DECORATION ────────────────────────────────────────────
 * `contact_compensations.confidence` is `self_reported | inferred | verified` and
 * defaults to `inferred`, because most compensation data is guessed by an
 * enrichment vendor. {@link compensationBenchmark} therefore reports the
 * confidence MIX beside every median rather than averaging across it: a median
 * built from inferences and a median built from verified offers are different
 * claims, and a single number cannot tell a recruiter which one they are holding.
 *
 * ── ONE CURRENT ROLE ────────────────────────────────────────────────────────
 * `is_current` has no unique index, so {@link setExperience} enforces it: marking
 * a role current clears the others in the same transaction. Two current roles is
 * not cosmetic — "everyone who works at X today" is exactly the query that breaks.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  contactCompensations,
  contactEducations,
  contactExperiences,
  savedContactSearches,
  savedSearches,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** `contact_compensations.confidence`. */
export const CONFIDENCE_LEVELS = ['self_reported', 'inferred', 'verified'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const isConfidence = (v: unknown): v is Confidence =>
  typeof v === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(v);

export class ContactProfileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ContactProfileError';
  }
}

const requireRef = (v: string): string => {
  const s = v.trim();
  if (!s || s.length > 64) throw new ContactProfileError('contactRef is required and must be 64 characters or fewer');
  return s;
};

const dec = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);

// ── The profile ─────────────────────────────────────────────────────────────

/** Everything known about one contact beyond their row — three queries, not one
 *  per section. */
export async function contactProfile(db: Db, tenantId: number, contactRef: string) {
  const ref = requireRef(contactRef);
  const [experiences, educations, compensations] = await Promise.all([
    db.select().from(contactExperiences)
      .where(scopedToTenant(contactExperiences, tenantId, eq(contactExperiences.contactRef, ref)))
      .orderBy(desc(contactExperiences.isCurrent), desc(contactExperiences.startedAt)),
    db.select().from(contactEducations)
      .where(scopedToTenant(contactEducations, tenantId, eq(contactEducations.contactRef, ref)))
      .orderBy(desc(contactEducations.endedAt)),
    db.select().from(contactCompensations)
      .where(scopedToTenant(contactCompensations, tenantId, eq(contactCompensations.contactRef, ref)))
      .orderBy(desc(contactCompensations.observedAt)),
  ]);
  return { contactRef: ref, experiences, educations, compensations };
}

export type ExperienceInput = {
  company?: string | null;
  title?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  isCurrent?: boolean;
  location?: string | null;
};

/**
 * Add or replace a role.
 *
 * Marking it current clears every other current role for the contact, in the same
 * transaction — see the module docstring. An `endedAt` in the past with
 * `isCurrent` true is rejected rather than accepted-and-ignored: it is a
 * contradiction, and storing it makes "who works there now" quietly wrong.
 */
export async function setExperience(
  db: Db,
  tenantId: number,
  contactRef: string,
  input: ExperienceInput,
) {
  const ref = requireRef(contactRef);
  if (input.isCurrent && input.endedAt) {
    throw new ContactProfileError('a current role cannot have an end date');
  }

  return db.transaction(async (tx) => {
    if (input.isCurrent) {
      await tx
        .update(contactExperiences)
        .set({ isCurrent: false })
        .where(scopedToTenant(contactExperiences, tenantId, and(
          eq(contactExperiences.contactRef, ref),
          eq(contactExperiences.isCurrent, true),
        )));
    }
    const [row] = await tx
      .insert(contactExperiences)
      .values({
        tenantId,
        contactRef: ref,
        company: input.company ?? null,
        title: input.title ?? null,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        isCurrent: input.isCurrent ?? false,
        location: input.location ?? null,
      })
      .returning();
    if (!row) throw new ContactProfileError('could not record the role');
    return row;
  });
}

export async function addEducation(
  db: Db,
  tenantId: number,
  contactRef: string,
  input: { institution?: string | null; degree?: string | null; field?: string | null; startedAt?: Date | null; endedAt?: Date | null },
) {
  const [row] = await db
    .insert(contactEducations)
    .values({
      tenantId,
      contactRef: requireRef(contactRef),
      institution: input.institution ?? null,
      degree: input.degree ?? null,
      field: input.field ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
    })
    .returning();
  if (!row) throw new ContactProfileError('could not record the education');
  return row;
}

/**
 * Record an observation of what someone is paid.
 *
 * An OBSERVATION, not a fact, which is why the table is append-only and carries
 * `observed_at` and `confidence`. Compensation moves and most of it is inferred;
 * overwriting a previous observation would destroy the only evidence of both.
 */
export async function recordCompensation(
  db: Db,
  tenantId: number,
  contactRef: string,
  input: { base?: number | null; bonus?: number | null; equity?: string | null; currency?: string; period?: string | null; confidence?: Confidence; observedAt?: Date },
) {
  const confidence = input.confidence ?? 'inferred';
  if (!isConfidence(confidence)) {
    throw new ContactProfileError(`confidence must be one of: ${CONFIDENCE_LEVELS.join(', ')}`);
  }
  const [row] = await db
    .insert(contactCompensations)
    .values({
      tenantId,
      contactRef: requireRef(contactRef),
      base: dec(input.base),
      bonus: dec(input.bonus),
      equity: input.equity ?? null,
      currency: input.currency ?? 'USD',
      period: input.period ?? null,
      confidence,
      ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    })
    .returning();
  if (!row) throw new ContactProfileError('could not record the compensation');
  return row;
}

// ── The two reads that pay for the tables ───────────────────────────────────

/**
 * Everyone who has worked at a company — the warm-intro query.
 *
 * `current` is reported per row rather than filtered out, because a FORMER
 * employee is often the better intro: they will talk to you, and they still know
 * everyone. Filtering to current staff answers a narrower question than the one
 * a seller is actually asking.
 */
export async function alumniOf(db: Db, tenantId: number, company: string) {
  const needle = company.trim();
  if (!needle) throw new ContactProfileError('company is required');
  return db
    .select({
      contactRef: contactExperiences.contactRef,
      company: contactExperiences.company,
      title: contactExperiences.title,
      startedAt: contactExperiences.startedAt,
      endedAt: contactExperiences.endedAt,
      isCurrent: contactExperiences.isCurrent,
      location: contactExperiences.location,
    })
    .from(contactExperiences)
    // Case-insensitive exact match, not a LIKE: "Acme" and "Acme Corp" are
    // different employers, and a prefix match silently merges them.
    .where(scopedToTenant(contactExperiences, tenantId, sql`lower(${contactExperiences.company}) = lower(${needle})`))
    .orderBy(desc(contactExperiences.isCurrent), desc(contactExperiences.startedAt));
}

/**
 * What a role pays, by confidence.
 *
 * Grouped BY confidence rather than averaged across it: a median built from
 * vendor inferences and one built from verified offers are different claims, and
 * collapsing them produces a number that looks authoritative and is not. The
 * caller gets both and decides which to show.
 *
 * `percentile_cont` rather than `avg`, because compensation is skewed and a mean
 * is dragged by one outlier founder salary.
 */
export async function compensationBenchmark(db: Db, tenantId: number, title: string) {
  const needle = title.trim();
  if (!needle) throw new ContactProfileError('title is required');

  return db
    .select({
      confidence: contactCompensations.confidence,
      currency: contactCompensations.currency,
      observations: sql<number>`count(*)::int`,
      medianBase: sql<number | null>`percentile_cont(0.5) within group (order by ${contactCompensations.base})`,
      p25Base: sql<number | null>`percentile_cont(0.25) within group (order by ${contactCompensations.base})`,
      p75Base: sql<number | null>`percentile_cont(0.75) within group (order by ${contactCompensations.base})`,
    })
    .from(contactCompensations)
    .innerJoin(contactExperiences, and(
      eq(contactExperiences.tenantId, contactCompensations.tenantId),
      eq(contactExperiences.contactRef, contactCompensations.contactRef),
      sql`lower(${contactExperiences.title}) = lower(${needle})`,
    ))
    .where(scopedToTenant(contactCompensations, tenantId, sql`${contactCompensations.base} is not null`))
    .groupBy(contactCompensations.confidence, contactCompensations.currency);
}

// ── Saved searches ──────────────────────────────────────────────────────────

/**
 * Share a saved search with a colleague, or claim one.
 *
 * `saved_contact_searches` is a JOIN between the platform-wide `saved_searches`
 * row and the person who keeps it, which is why this is an enrolment rather than
 * a copy: two sellers watching the same segment must see the same segment, and
 * copying the criteria is how they drift apart the first time one edits it.
 */
export async function claimSearch(db: Db, tenantId: number, savedSearchId: number, ownerRef: string) {
  const [search] = await db
    .select({ id: savedSearches.id })
    .from(savedSearches)
    .where(scopedToTenant(savedSearches, tenantId, eq(savedSearches.id, savedSearchId)))
    .limit(1);
  if (!search) throw new ContactProfileError('saved search not found', 404);

  const [row] = await db
    .insert(savedContactSearches)
    .values({ tenantId, savedSearchId, ownerRef: requireRef(ownerRef) })
    .returning();
  if (!row) throw new ContactProfileError('could not claim the search');
  return row;
}

/** The searches this person keeps, with the criteria they actually watch. */
export async function searchesFor(db: Db, tenantId: number, ownerRef: string) {
  return db
    .select({
      id: savedContactSearches.id,
      savedSearchId: savedContactSearches.savedSearchId,
      claimedAt: savedContactSearches.createdAt,
      search: savedSearches,
    })
    .from(savedContactSearches)
    .innerJoin(savedSearches, eq(savedContactSearches.savedSearchId, savedSearches.id))
    .where(scopedToTenant(savedContactSearches, tenantId, eq(savedContactSearches.ownerRef, requireRef(ownerRef))))
    .orderBy(asc(savedSearches.name));
}

export async function releaseSearch(db: Db, tenantId: number, id: number, ownerRef: string) {
  const [row] = await db
    .delete(savedContactSearches)
    .where(scopedToTenant(savedContactSearches, tenantId, and(
      eq(savedContactSearches.id, id),
      eq(savedContactSearches.ownerRef, requireRef(ownerRef)),
    )))
    .returning({ id: savedContactSearches.id });
  if (!row) throw new ContactProfileError('you do not hold that search', 404);
  return { released: id };
}

/** Saved searches nobody keeps — the ones a workspace can safely retire. Uses a
 *  LEFT JOIN rather than a NOT IN so an empty claim table does not make every
 *  search look orphaned. */
export async function unclaimedSearches(db: Db, tenantId: number) {
  return db
    .select({ id: savedSearches.id, name: savedSearches.name })
    .from(savedSearches)
    .leftJoin(savedContactSearches, eq(savedContactSearches.savedSearchId, savedSearches.id))
    .where(scopedToTenant(savedSearches, tenantId, isNull(savedContactSearches.id)))
    .orderBy(asc(savedSearches.name));
}
