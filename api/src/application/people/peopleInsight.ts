/**
 * Team health, emergency contacts and cohort retention (PRD 19 §9).
 *
 * Three tables with one thing in common: each is a fact about PEOPLE that the
 * platform declared and never read.
 *
 *   `health_dimensions`      the axes a team-health score is measured on, with
 *                            weights and benchmarks. The vocabulary, not the score.
 *   `hr_emergency_contacts`  who to call. The most sensitive rows in the schema
 *                            and the least interesting until the day they matter.
 *   `cohort_retention`       whether a cohort stayed — in `hiring`, because the
 *                            cohort that matters there is a hiring cohort.
 *
 * ── DIMENSIONS ARE A VOCABULARY, NOT A SCORE ────────────────────────────────
 * `health_dimensions` carries `weight` and `benchmark`; the responses live in
 * `pulse_responses` and the surveys in the existing pulse owner. So this module
 * defines and weights the axes and refuses to compute a score from data it does
 * not own — {@link weightedScore} takes the per-dimension values as an ARGUMENT.
 * A module that reached across to read responses would become a second answer to
 * "how is the team", competing with the pulse owner's own.
 *
 * ── WEIGHTS ARE NORMALISED AT READ, NOT AT WRITE ────────────────────────────
 * {@link weightedScore} divides by the total weight of the dimensions actually
 * SCORED, not by the total of all dimensions. Otherwise a survey that skipped one
 * axis silently scores the team lower — the missing axis contributes zero to the
 * numerator and its full weight to the denominator, which reads as a failing
 * grade for a question nobody asked.
 *
 * ── EMERGENCY CONTACTS ARE MANAGER-ONLY AND MINIMAL ─────────────────────────
 * Exactly one primary contact per employee, enforced by {@link setEmergencyContact}
 * in a transaction. The reads here return the contact and nothing else about the
 * employee: this data exists for one purpose and widening the read is how it ends
 * up on a dashboard.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { cohortRetention, healthDimensions, hrEmergencyContacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export class PeopleInsightError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'PeopleInsightError';
  }
}

// ── Health dimensions ───────────────────────────────────────────────────────

export async function listDimensions(db: Db, tenantId: number) {
  return db
    .select()
    .from(healthDimensions)
    .where(scopedToTenant(healthDimensions, tenantId))
    .orderBy(asc(healthDimensions.position), asc(healthDimensions.key));
}

export async function upsertDimension(
  db: Db,
  tenantId: number,
  input: { key: string; label: string; description?: string | null; weight?: number; benchmark?: number | null; position?: number },
) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new PeopleInsightError('key is required');
  const weight = input.weight ?? 1;
  if (weight <= 0) throw new PeopleInsightError('weight must be positive — a zero-weight axis is one to delete, not to keep');

  const [existing] = await db
    .select({ id: healthDimensions.id })
    .from(healthDimensions)
    .where(scopedToTenant(healthDimensions, tenantId, eq(healthDimensions.key, key)))
    .limit(1);

  const values = {
    tenantId,
    key: key.slice(0, 64),
    label: input.label.trim().slice(0, 200),
    description: input.description ?? null,
    weight: String(weight),
    benchmark: input.benchmark === null || input.benchmark === undefined ? null : String(input.benchmark),
    position: input.position ?? 0,
  };

  const [row] = existing
    ? await db.update(healthDimensions).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(healthDimensions, tenantId, eq(healthDimensions.id, existing.id))).returning()
    : await db.insert(healthDimensions).values(values).returning();
  if (!row) throw new PeopleInsightError('could not save the dimension');
  return row;
}

/**
 * Combine per-dimension scores into one number.
 *
 * Takes the scores as an argument rather than reading them — see the module
 * docstring. Normalises over the dimensions actually SCORED, so a skipped axis
 * does not read as a failing grade, and reports which axes were missing so the
 * caller can say the score is partial rather than pretending it is not.
 */
export async function weightedScore(
  db: Db,
  tenantId: number,
  scores: Record<string, number>,
) {
  const dimensions = await listDimensions(db, tenantId);
  if (dimensions.length === 0) {
    throw new PeopleInsightError('no health dimensions are defined for this workspace', 409);
  }

  let weighted = 0;
  let scoredWeight = 0;
  const missing: string[] = [];
  const breakdown: { key: string; label: string; score: number | null; weight: number; benchmark: number | null }[] = [];

  for (const d of dimensions) {
    const weight = Number(d.weight);
    const score = scores[d.key];
    const benchmark = d.benchmark === null ? null : Number(d.benchmark);
    if (score === undefined || !Number.isFinite(score)) {
      missing.push(d.key);
      breakdown.push({ key: d.key, label: d.label, score: null, weight, benchmark });
      continue;
    }
    weighted += score * weight;
    scoredWeight += weight;
    breakdown.push({ key: d.key, label: d.label, score, weight, benchmark });
  }

  return {
    // Null rather than 0 when nothing was scored: an unanswered survey is not a
    // score of zero.
    score: scoredWeight > 0 ? weighted / scoredWeight : null,
    breakdown,
    missing,
    partial: missing.length > 0,
  };
}

// ── Emergency contacts ──────────────────────────────────────────────────────

/**
 * Record a contact. Marking one primary clears the others in the same
 * transaction — on the day this data is used, "which one do I call" must have
 * exactly one answer.
 */
export async function setEmergencyContact(
  db: Db,
  tenantId: number,
  employeeId: number,
  input: { name: string; relationship?: string | null; phone?: string | null; email?: string | null; isPrimary?: boolean },
) {
  if (!input.phone && !input.email) {
    throw new PeopleInsightError('an emergency contact needs a phone number or an email — a name alone cannot be reached');
  }

  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx
        .update(hrEmergencyContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(scopedToTenant(hrEmergencyContacts, tenantId, and(
          eq(hrEmergencyContacts.employeeId, employeeId),
          eq(hrEmergencyContacts.isPrimary, true),
        )));
    }
    const [row] = await tx
      .insert(hrEmergencyContacts)
      .values({
        tenantId,
        employeeId,
        name: input.name.trim().slice(0, 200),
        relationship: input.relationship ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        isPrimary: input.isPrimary ?? false,
      })
      .returning();
    if (!row) throw new PeopleInsightError('could not record the contact');
    return row;
  });
}

/** One employee's contacts, primary first. Returns the contacts and nothing
 *  else — see the module docstring. */
export async function emergencyContactsFor(db: Db, tenantId: number, employeeId: number) {
  return db
    .select({
      id: hrEmergencyContacts.id,
      name: hrEmergencyContacts.name,
      relationship: hrEmergencyContacts.relationship,
      phone: hrEmergencyContacts.phone,
      email: hrEmergencyContacts.email,
      isPrimary: hrEmergencyContacts.isPrimary,
    })
    .from(hrEmergencyContacts)
    .where(scopedToTenant(hrEmergencyContacts, tenantId, eq(hrEmergencyContacts.employeeId, employeeId)))
    .orderBy(desc(hrEmergencyContacts.isPrimary), asc(hrEmergencyContacts.name));
}

export async function deleteEmergencyContact(db: Db, tenantId: number, id: number) {
  const [row] = await db
    .delete(hrEmergencyContacts)
    .where(scopedToTenant(hrEmergencyContacts, tenantId, eq(hrEmergencyContacts.id, id)))
    .returning({ id: hrEmergencyContacts.id });
  if (!row) throw new PeopleInsightError('contact not found', 404);
  return { deleted: id };
}

/** Employees with no contact on file — the gap an HR lead needs to close, and
 *  the only aggregate this data is used for. */
export async function employeesMissingContacts(db: Db, tenantId: number, employeeIds: number[]) {
  if (employeeIds.length === 0) return [];
  const have = await db
    .select({ employeeId: hrEmergencyContacts.employeeId })
    .from(hrEmergencyContacts)
    .where(scopedToTenant(hrEmergencyContacts, tenantId));
  const covered = new Set(have.map((h) => h.employeeId));
  return employeeIds.filter((id) => !covered.has(id));
}

// ── Cohort retention ────────────────────────────────────────────────────────

/**
 * Record one cohort measurement.
 *
 * `retention_rate` is DERIVED here rather than accepted from the caller: a stored
 * rate that disagrees with its own numerator and denominator is the kind of row
 * nobody notices until a board deck is wrong.
 */
export async function recordCohort(
  db: Db,
  tenantId: number,
  input: { cohortKey: string; cohortStartedAt: Date; periodDays: number; startingCount: number; retainedCount: number },
) {
  if (input.startingCount <= 0) throw new PeopleInsightError('startingCount must be positive');
  if (input.retainedCount < 0 || input.retainedCount > input.startingCount) {
    throw new PeopleInsightError('retainedCount must be between 0 and startingCount');
  }

  const rate = (input.retainedCount / input.startingCount) * 100;
  const [row] = await db
    .insert(cohortRetention)
    .values({
      tenantId,
      cohortKey: input.cohortKey.trim().slice(0, 64),
      cohortStartedAt: input.cohortStartedAt,
      periodDays: input.periodDays,
      startingCount: input.startingCount,
      retainedCount: input.retainedCount,
      retentionRate: rate.toFixed(2),
    })
    .returning();
  if (!row) throw new PeopleInsightError('could not record the cohort');
  return row;
}

/**
 * The retention curve for one cohort — every period, in order.
 *
 * Ordered by `period_days` rather than by insertion, because measurements arrive
 * out of order (a 90-day figure is recorded before a backfilled 30-day one) and a
 * curve plotted in insertion order zig-zags.
 */
export async function cohortCurve(db: Db, tenantId: number, cohortKey: string) {
  return db
    .select()
    .from(cohortRetention)
    .where(scopedToTenant(cohortRetention, tenantId, eq(cohortRetention.cohortKey, cohortKey.trim())))
    .orderBy(asc(cohortRetention.periodDays));
}

/**
 * Compare cohorts at one horizon — the read that answers "are our hires sticking
 * better than they used to".
 *
 * Pinned to a single `periodDays` on purpose: comparing a cohort's 30-day figure
 * with another's 90-day figure is the most common way this table gets misread.
 */
export async function cohortComparison(db: Db, tenantId: number, periodDays: number) {
  return db
    .select({
      cohortKey: cohortRetention.cohortKey,
      cohortStartedAt: cohortRetention.cohortStartedAt,
      startingCount: cohortRetention.startingCount,
      retainedCount: cohortRetention.retainedCount,
      retentionRate: cohortRetention.retentionRate,
    })
    .from(cohortRetention)
    .where(scopedToTenant(cohortRetention, tenantId, eq(cohortRetention.periodDays, periodDays)))
    .orderBy(asc(cohortRetention.cohortStartedAt));
}

/** Retention at each horizon across every cohort — the platform-level curve. */
export async function retentionByHorizon(db: Db, tenantId: number) {
  return db
    .select({
      periodDays: cohortRetention.periodDays,
      cohorts: sql<number>`count(*)::int`,
      starting: sql<number>`coalesce(sum(${cohortRetention.startingCount}), 0)::int`,
      retained: sql<number>`coalesce(sum(${cohortRetention.retainedCount}), 0)::int`,
      // Pooled rather than an average of rates: averaging rates over cohorts of
      // very different sizes lets a three-person cohort outvote a hundred-person one.
      pooledRate: sql<number | null>`(
        coalesce(sum(${cohortRetention.retainedCount}), 0)::float8
        / nullif(sum(${cohortRetention.startingCount}), 0)
      )`,
    })
    .from(cohortRetention)
    .where(scopedToTenant(cohortRetention, tenantId))
    .groupBy(cohortRetention.periodDays)
    .orderBy(asc(cohortRetention.periodDays));
}
