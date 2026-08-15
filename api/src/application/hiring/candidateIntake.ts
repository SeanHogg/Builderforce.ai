/**
 * A person becomes a CANDIDATE in one employer's workspace.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `party_roles` and `candidate_resumes` both landed with the PRD 20 hiring domain
 * (migration 0419) and neither had a writer, so the Recruiter seat owned two tables
 * describing candidates that no candidate was ever written into. Every downstream
 * capability was unreachable as a result: consent and the retention clock
 * (`candidateRecords.ts`), erasure, the diversity report, and any matcher that wants a
 * tenant-scoped résumé to score.
 *
 * Applying is the event that creates a candidate, so this is the one place that does it.
 * It is deliberately a single use case rather than two calls at the route, because a
 * party role with no résumé and a résumé with no party role are both broken states, and
 * a caller that has to remember two steps eventually writes only one.
 *
 * ── THE REF ──────────────────────────────────────────────────────────────────────
 * A platform applicant's `party_ref` is their user id passed through `partyRef()`. A ref
 * derived from a display name would merge two people called John Smith into one
 * candidate the first time both applied — the exact string-matching defect the party
 * module exists to remove. A uuid is already lower-case `[a-z0-9-]`, so `partyRef` is
 * the identity function on it and the format contract still holds.
 */
import { sql } from 'drizzle-orm';
import { partyRef } from '@builderforce/creation-canvas-contract';
import { partyRoles } from '../../infrastructure/database/schema';
import { projectResumeToCandidate } from './candidateResumeProjection';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';

/** The reference an employer's ATS addresses this platform user by. */
export function candidateRefForUser(userId: string): string {
  return partyRef(userId);
}

export interface CandidateIntakeResult {
  candidateRef: string;
  /** True when a résumé snapshot was written for the employer to screen. */
  resumeProjected: boolean;
}

/**
 * Register the applicant as a candidate of this tenant and snapshot their résumé.
 *
 * Idempotent — a second application to the same employer refreshes the résumé and
 * leaves the existing role (and therefore its consent basis and retention clock)
 * untouched, because re-applying is not a new lawful basis.
 *
 * Never throws: an application must not fail because its ATS bookkeeping did. The
 * proposal is the thing the person asked for; this is the employer's record of it.
 */
export async function admitCandidate(
  db: Db,
  args: { userId: string; tenantId: number; source?: string },
): Promise<CandidateIntakeResult> {
  const candidateRef = candidateRefForUser(args.userId);
  try {
    await db.insert(partyRoles)
      .values({
        tenantId: args.tenantId,
        partyKind: 'person',
        partyRef: candidateRef,
        role: 'candidate',
        status: 'active',
        startedAt: sql`now()`,
        attrs: { userId: args.userId, source: args.source ?? 'marketplace' },
      })
      // Re-applying must not reset the retention clock or re-open a closed role, so
      // only the freshness stamp moves.
      .onConflictDoNothing({
        target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role],
      });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/hiring/candidateIntake.ts',
      operation: 'admitCandidate.partyRole',
      context: { userId: args.userId, tenantId: args.tenantId },
    });
  }

  const { projected } = await projectResumeToCandidate(db, {
    userId: args.userId,
    tenantId: args.tenantId,
    candidateRef,
  });
  return { candidateRef, resumeProjected: projected };
}
