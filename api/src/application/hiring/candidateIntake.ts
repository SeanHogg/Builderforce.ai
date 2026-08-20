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
 * ── ONE ACT ──────────────────────────────────────────────────────────────────────
 * Applying also RECORDS THE APPLICATION (0983). `job_applications` had no writer for the
 * same mechanical reason it had no data: its `job_posting_id` was `integer` while
 * `job_postings.id` is `varchar(36)`, so there was no way to say which posting a
 * candidate had applied to. With the column widened, admitting somebody and recording
 * what they applied to happen in this one function rather than being sequenced by a
 * caller — the argument this module already makes about the party role and the résumé
 * ("a caller that has to remember two steps eventually writes only one") applies with
 * more force here, because the forgotten step is the one the recruiter's board reads.
 *
 * `jobPostingId` is optional because one caller genuinely does not have one: a person can
 * be admitted as a candidate of a workspace without a specific requisition. When it is
 * absent no application is written — an application to nothing is not an application, and
 * inventing a row with a NULL posting would defeat the table's own uniqueness index
 * (Postgres treats NULLs as distinct, so re-applying would append a duplicate every time).
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
import { recordApplication } from './applications';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** The reference an employer's ATS addresses this platform user by. */
export function candidateRefForUser(userId: string): string {
  return partyRef(userId);
}

export interface CandidateIntakeResult {
  candidateRef: string;
  /** True when a résumé snapshot was written for the employer to screen. */
  resumeProjected: boolean;
  /** The `job_applications` row this created or refreshed, when a posting was named. */
  applicationId: number | null;
}

export interface AdmitCandidateInput {
  userId: string;
  tenantId: number;
  source?: string;
  /**
   * `job_postings.id`. When present the application is recorded and the candidate enters
   * that posting's pipeline; when absent the person is admitted as a candidate of the
   * workspace and nothing else.
   */
  jobPostingId?: string | null;
  coverLetter?: string | null;
  /** Only used to drop the caches the new pipeline entry invalidates; absent is safe. */
  env?: Env;
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
  args: AdmitCandidateInput,
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

  // The application itself. Held to the same never-throws contract as the rest of this
  // function: the person asked to apply, and the employer's bookkeeping failing is not a
  // reason to tell them they did not. The failure is reported rather than swallowed, so a
  // pipeline that is quietly missing candidates is diagnosable instead of merely empty.
  let applicationId: number | null = null;
  if (args.jobPostingId) {
    try {
      const recorded = await recordApplication(db, args.env, {
        tenantId: args.tenantId,
        jobPostingId: args.jobPostingId,
        candidateRef,
        source: args.source ?? 'marketplace',
        coverLetter: args.coverLetter ?? null,
      });
      applicationId = recorded.applicationId;
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/hiring/candidateIntake.ts',
        operation: 'admitCandidate.recordApplication',
        context: { userId: args.userId, tenantId: args.tenantId, jobPostingId: args.jobPostingId },
      });
    }
  }

  return { candidateRef, resumeProjected: projected, applicationId };
}
