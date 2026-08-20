/**
 * `job_applications` — the missing writer.
 *
 * ── WHY THIS TABLE WAS EMPTY ─────────────────────────────────────────────────────
 * `admitCandidate` already registers a person as a CANDIDATE of an employer and
 * snapshots the résumé they applied with. What it could not do was record WHAT they
 * applied to: `job_applications.job_posting_id` was `integer` while `job_postings.id` is
 * `varchar(36)`, so the column could not hold a posting id at all. Migration 0983 widens
 * it; this module is what then writes the row.
 *
 * ── ONE ACT, NOT TWO CALLS ───────────────────────────────────────────────────────
 * Admitting a candidate and recording their application are the same event and are
 * therefore ONE function call. `candidateIntake.admitCandidate` calls
 * {@link recordApplication} directly rather than the two being sequenced at the route,
 * for exactly the reason its own docstring gives about the party role and the résumé: "a
 * caller that has to remember two steps eventually writes only one", and the step that
 * gets forgotten is invisible — a candidate with a party role, a résumé and no
 * application looks fine on every screen except the one a recruiter works from.
 *
 * ── AND ONE PIPELINE ENTRY ───────────────────────────────────────────────────────
 * Recording an application also enters the candidate into the posting's pipeline at the
 * ladder's first stage. An application that is not on the board is an application nobody
 * will action, and it is also invisible to the funnel, which counts pipeline entries
 * rather than applications. Both writes are here so neither can be skipped.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { candidateResumes, jobApplications } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { enterPipeline, moveCandidate, type PipelineEntryRef } from './pipeline';
import { AtsError } from './atsError';
import { ENTRY_STAGE, REJECTED_STAGE, pipelineRefForPosting } from '../../domain/hiring/pipelineStages';
import type { Env } from '../../env';

/** How many applications one list read returns. A posting with more than this has a
 *  filter problem rather than a paging problem, and the board is the surface for
 *  working them. */
const LIST_LIMIT = 200;

export interface AtsApplication {
  id: number;
  jobPostingId: string | null;
  candidateRef: string;
  source: string;
  status: string;
  score: number | null;
  appliedAt: string;
  rejectedAt: string | null;
  rejectReason: string | null;
  /** From the employer-side résumé snapshot — the same copy the board's cards show. */
  headline: string | null;
  yearsExp: number | null;
  skills: string[];
}

export interface AtsApplicationDetail extends AtsApplication {
  coverLetter: string | null;
  resumeRef: string | null;
}

interface ApplicationRow {
  id: number;
  jobPostingId: string | null;
  candidateRef: string;
  source: string;
  status: string;
  score: string | null;
  appliedAt: Date | string;
  rejectedAt: Date | string | null;
  rejectReason: string | null;
  coverLetter: string | null;
  resumeRef: string | null;
  headline: string | null;
  yearsExp: string | null;
  skills: unknown;
}

const iso = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function toApplication(row: ApplicationRow): AtsApplicationDetail {
  return {
    id: row.id,
    jobPostingId: row.jobPostingId ?? null,
    candidateRef: row.candidateRef,
    source: row.source,
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    appliedAt: iso(row.appliedAt) ?? new Date(0).toISOString(),
    rejectedAt: iso(row.rejectedAt),
    rejectReason: row.rejectReason ?? null,
    headline: row.headline ?? null,
    yearsExp: row.yearsExp === null ? null : Number(row.yearsExp),
    skills: Array.isArray(row.skills) ? (row.skills as string[]).filter((s): s is string => typeof s === 'string') : [],
    coverLetter: row.coverLetter ?? null,
    resumeRef: row.resumeRef ?? null,
  };
}

const APPLICATION_COLUMNS = {
  id: jobApplications.id,
  jobPostingId: jobApplications.jobPostingId,
  candidateRef: jobApplications.candidateRef,
  source: jobApplications.source,
  status: jobApplications.status,
  score: jobApplications.score,
  appliedAt: jobApplications.appliedAt,
  rejectedAt: jobApplications.rejectedAt,
  rejectReason: jobApplications.rejectReason,
  coverLetter: jobApplications.coverLetter,
  resumeRef: jobApplications.resumeRef,
  headline: candidateResumes.headline,
  yearsExp: candidateResumes.yearsExp,
  skills: candidateResumes.skills,
} as const;

export interface RecordApplicationInput {
  tenantId: number;
  /** `job_postings.id`. Required: an application to nothing is not an application. */
  jobPostingId: string;
  candidateRef: string;
  source?: string | null;
  coverLetter?: string | null;
  /** The `candidate_resumes` row this was submitted with, when there is one. */
  resumeRef?: string | null;
  ownerRef?: string | null;
}

export interface RecordApplicationResult {
  applicationId: number;
  /** False when this person had already applied — the row was refreshed, not duplicated. */
  created: boolean;
  entry: PipelineEntryRef;
}

/**
 * Record an application, and put the candidate on the board.
 *
 * Idempotent on `(tenant, posting, candidate)` — the table's own unique index. Re-applying
 * REFRESHES the cover letter and résumé pointer rather than creating a second row, for
 * the same reason `projectResumeToCandidate` refreshes the snapshot: a recruiter wants
 * what this person applies with, not a pile of near-identical copies. `applied_at` is
 * deliberately NOT refreshed — time-to-hire is measured from when they first applied,
 * and re-submitting a cover letter would otherwise reset every ageing metric on the
 * board.
 */
export async function recordApplication(
  db: Db,
  env: Env | undefined,
  input: RecordApplicationInput,
): Promise<RecordApplicationResult> {
  const jobPostingId = input.jobPostingId.trim();
  if (!jobPostingId) throw new AtsError('An application needs the posting it is for.', 400);
  const candidateRef = input.candidateRef.trim();
  if (!candidateRef) throw new AtsError('An application needs a candidate.', 400);

  const source = (input.source ?? 'direct').trim().slice(0, 48) || 'direct';
  const [row] = await db
    .insert(jobApplications)
    .values({
      tenantId: input.tenantId,
      jobPostingId,
      candidateRef,
      source,
      status: ENTRY_STAGE,
      coverLetter: input.coverLetter?.slice(0, 20_000) ?? null,
      resumeRef: input.resumeRef ?? null,
    })
    .onConflictDoUpdate({
      target: [jobApplications.tenantId, jobApplications.jobPostingId, jobApplications.candidateRef],
      set: {
        coverLetter: sql`coalesce(excluded.cover_letter, ${jobApplications.coverLetter})`,
        resumeRef: sql`coalesce(excluded.resume_ref, ${jobApplications.resumeRef})`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: jobApplications.id, appliedAt: jobApplications.appliedAt });
  if (!row) throw new AtsError('The application could not be recorded.', 500);

  // An upsert cannot tell you which arm ran, and the answer matters to the caller (the
  // marketplace reports "applied" vs "updated"). The pipeline entry knows: it is created
  // exactly once per candidate per pipeline, so its own `created` flag is the honest
  // signal without a second read.
  const entry = await enterPipeline(db, env, {
    tenantId: input.tenantId,
    pipelineRef: pipelineRefForPosting(jobPostingId),
    candidateRef,
    applicationId: row.id,
    stage: ENTRY_STAGE,
    source,
    ownerRef: input.ownerRef ?? null,
  });

  return { applicationId: row.id, created: entry.created, entry };
}

/** The applications for a posting, newest first. */
export async function listApplications(
  db: Db,
  tenantId: number,
  opts: { jobPostingId?: string | null; status?: string | null; candidateRef?: string | null; limit?: number } = {},
): Promise<AtsApplication[]> {
  const rows = await db
    .select(APPLICATION_COLUMNS)
    .from(jobApplications)
    .leftJoin(candidateResumes, and(
      eq(candidateResumes.tenantId, jobApplications.tenantId),
      eq(candidateResumes.candidateRef, jobApplications.candidateRef),
    ))
    .where(scopedToTenant(
      jobApplications,
      tenantId,
      opts.jobPostingId ? eq(jobApplications.jobPostingId, opts.jobPostingId) : undefined,
      opts.status ? eq(jobApplications.status, opts.status) : undefined,
      opts.candidateRef ? eq(jobApplications.candidateRef, opts.candidateRef) : undefined,
    ))
    .orderBy(desc(jobApplications.appliedAt))
    .limit(Math.max(1, Math.min(LIST_LIMIT, Math.floor(opts.limit ?? LIST_LIMIT))));
  return (rows as unknown as ApplicationRow[]).map(toApplication);
}

/** One application, with the cover letter the list omits. */
export async function readApplication(
  db: Db,
  tenantId: number,
  applicationId: number,
): Promise<AtsApplicationDetail | null> {
  const [row] = await db
    .select(APPLICATION_COLUMNS)
    .from(jobApplications)
    .leftJoin(candidateResumes, and(
      eq(candidateResumes.tenantId, jobApplications.tenantId),
      eq(candidateResumes.candidateRef, jobApplications.candidateRef),
    ))
    .where(scopedToTenant(jobApplications, tenantId, eq(jobApplications.id, applicationId)))
    .limit(1);
  return row ? toApplication(row as unknown as ApplicationRow) : null;
}

export interface RejectApplicationInput {
  tenantId: number;
  applicationId: number;
  /** Why. Required — see below. */
  reason: string;
}

/**
 * Reject an application, with the reason on the row.
 *
 * The reason is REQUIRED and not defaulted. `reject_reason` exists so that "why did we
 * turn this person down" has an answer six months later, when it is asked by a candidate,
 * a regulator or the next recruiter about to source the same person; a nullable reason
 * that the UI is trusted to fill in is a reason that is null on the rejections that
 * matter. It is also the input to the rejection ANALYSIS the funnel's bottleneck points
 * at.
 *
 * The board follows: the candidate moves to the terminal `rejected` stage, which closes
 * their open entry with its clock stamped, so the funnel's conversion out of whatever
 * stage they were in is correct. `recordDecision` is the door most callers should use —
 * it writes the accountable record and then calls this.
 */
export async function rejectApplication(
  db: Db,
  env: Env | undefined,
  input: RejectApplicationInput,
  now = new Date(),
): Promise<{ applicationId: number; movedFrom: string | null }> {
  const reason = input.reason.trim().slice(0, 160);
  if (!reason) throw new AtsError('A rejection needs a reason — it is the answer to "why" six months from now.', 400);

  const application = await readApplication(db, input.tenantId, input.applicationId);
  if (!application) throw new AtsError('No such application in this workspace.', 404);
  if (application.rejectedAt) throw new AtsError('That application was already rejected.', 409);

  await db
    .update(jobApplications)
    .set({ status: REJECTED_STAGE, rejectedAt: now, rejectReason: reason, updatedAt: now })
    .where(scopedToTenant(jobApplications, input.tenantId, eq(jobApplications.id, input.applicationId)));

  // The pipeline move is best-effort ONLY in the sense that a candidate who was never on
  // a board has nothing to move; a genuine failure still propagates, because a rejected
  // application still sitting in `interview` on the board is the state this whole module
  // exists to prevent.
  let movedFrom: string | null = null;
  if (application.jobPostingId) {
    const move = await moveCandidate(db, env, {
      tenantId: input.tenantId,
      pipelineRef: pipelineRefForPosting(application.jobPostingId),
      candidateRef: application.candidateRef,
      toStage: REJECTED_STAGE,
    }, now).catch((error: unknown) => {
      // A candidate with no open entry is not an error — they were rejected from the
      // applications list before anybody put them on the board. Anything else is.
      if (error instanceof AtsError && error.status === 404) return null;
      throw error;
    });
    movedFrom = move?.fromStage ?? null;
  }

  return { applicationId: input.applicationId, movedFrom };
}
