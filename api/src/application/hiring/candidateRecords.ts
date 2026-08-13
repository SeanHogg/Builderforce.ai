/**
 * The lawful-basis, retention and erasure half of a candidate record.
 *
 * ── WHY THIS IS A SERVICE AND NOT A ROUTE ────────────────────────────────────────
 * A route takes an application port; it does not reach for a table. That rule earns its
 * keep here more than almost anywhere else, because these four operations have real
 * invariants that must hold whoever calls them — a lawful basis is a closed set, an
 * erasure has to clear the segregated demographic rows as well as mark the role, and the
 * aggregate report must never return a group small enough to re-identify somebody. Put
 * any of that in a handler and the second caller re-implements it slightly differently.
 *
 * ── THE TWO OPPOSITE CLOCKS ──────────────────────────────────────────────────────
 * `retentionBasis` is `erase-by` for a rejected candidate (a MAXIMUM retention) and
 * `retain-until` for an employment record (a statutory MINIMUM). One pair of columns
 * carries both because they are one fact — when the law stops protecting this record —
 * read from opposite ends. See migration 0460.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { candidateDemographics } from '../../infrastructure/database/schema/hiring';
import { partyRoles } from '../../infrastructure/database/schema/kernel';

/** Lawful bases a record may be held under. A closed set: "other" is not a lawful basis,
 *  and letting one be typed is how an unlawful hold becomes an unremarkable string. */
export const LAWFUL_BASES = ['consent', 'legitimate-interest', 'contract', 'legal-obligation'] as const;
export const RETENTION_BASES = ['erase-by', 'retain-until'] as const;

export type LawfulBasis = typeof LAWFUL_BASES[number];
export type RetentionBasis = typeof RETENTION_BASES[number];

export function isLawfulBasis(value: unknown): value is LawfulBasis {
  return typeof value === 'string' && (LAWFUL_BASES as readonly string[]).includes(value);
}

export function isRetentionBasis(value: unknown): value is RetentionBasis {
  return typeof value === 'string' && (RETENTION_BASES as readonly string[]).includes(value);
}

export interface ConsentInput {
  basis: LawfulBasis;
  consentAt?: string;
  retentionBasis?: RetentionBasis;
  /** ISO date. */
  retentionDate?: string;
}

/** Record the basis this candidate record is held under, and its clock. */
export async function recordCandidateConsent(
  db: Db,
  tenantId: number,
  candidateRef: string,
  input: ConsentInput,
): Promise<{ ok: true } | { ok: false; reason: 'no-candidate' }> {
  const updated = await db.update(partyRoles).set({
    consentBasis: input.basis,
    consentAt: input.consentAt ? new Date(input.consentAt) : new Date(),
    ...(input.retentionBasis ? { retentionBasis: input.retentionBasis } : {}),
    ...(input.retentionDate ? { retentionDate: input.retentionDate } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(partyRoles.tenantId, tenantId),
    eq(partyRoles.partyRef, candidateRef),
    eq(partyRoles.role, 'candidate'),
  )).returning({ id: partyRoles.id });

  return updated.length ? { ok: true } : { ok: false, reason: 'no-candidate' };
}

/**
 * Honour an erasure request.
 *
 * The role row is RETAINED AND MARKED rather than deleted, which is the standard shape
 * for a suppression record: a deleted row cannot stop a re-import bringing the person
 * back, and resurrecting somebody who exercised their right to be forgotten is a second
 * breach rather than a recovery. `attrs` is cleared because the payload IS the personal
 * data — a row that claims to be erased and still holds it is worse than one that never
 * claimed.
 */
export async function eraseCandidateRecord(
  db: Db,
  tenantId: number,
  candidateRef: string,
): Promise<{ ok: true; erasedAt: string } | { ok: false; reason: 'no-candidate' }> {
  const now = new Date();
  const updated = await db.update(partyRoles).set({
    erasedAt: now,
    status: 'erased',
    attrs: null,
    updatedAt: now,
  }).where(and(
    eq(partyRoles.tenantId, tenantId),
    eq(partyRoles.partyRef, candidateRef),
    eq(partyRoles.role, 'candidate'),
  )).returning({ id: partyRoles.id });

  if (!updated.length) return { ok: false, reason: 'no-candidate' };

  // The segregated table is DELETED rather than marked: it exists only to be reported in
  // aggregate, so there is nothing a retained row could legitimately be used for.
  await db.delete(candidateDemographics).where(and(
    eq(candidateDemographics.tenantId, tenantId),
    eq(candidateDemographics.candidateRef, candidateRef),
  ));

  return { ok: true, erasedAt: now.toISOString() };
}

/**
 * The MINIMUM group a diversity report will disclose.
 *
 * A count of one re-identifies the person as surely as their name would, which is
 * exactly the disclosure the segregation exists to prevent. Five is the conventional
 * floor for statutory reporting and it is enforced here rather than in the route, so no
 * second caller can lower it.
 */
export const MIN_REPORTABLE_GROUP = 5;

export interface DiversityReport {
  minimumGroupSize: number;
  /** How many groups were withheld. Reported so the reader knows the table is partial —
   *  a silently truncated report reads as complete, which is its own kind of wrong. */
  suppressedGroups: number;
  counts: Array<{ category: string; response: string; count: number }>;
}

/**
 * Aggregate EEO counts, with no identifiers.
 *
 * The ONLY read of `candidate_demographics` anywhere, which is why that entity is
 * registered `restricted` and unreachable through the generic entity reader: the lawful
 * use of this data is aggregate reporting, and a row-level read beside a candidate is
 * the unlawful one.
 */
export async function candidateDiversityReport(db: Db, tenantId: number): Promise<DiversityReport> {
  const rows = await db
    .select({
      category: candidateDemographics.category,
      response: candidateDemographics.response,
      count: sql<number>`count(*)::int`,
    })
    .from(candidateDemographics)
    .where(eq(candidateDemographics.tenantId, tenantId))
    .groupBy(candidateDemographics.category, candidateDemographics.response);

  const reported = rows.filter((row) => row.count >= MIN_REPORTABLE_GROUP);
  return {
    minimumGroupSize: MIN_REPORTABLE_GROUP,
    suppressedGroups: rows.length - reported.length,
    counts: reported,
  };
}
