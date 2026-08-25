/**
 * FO-B3 — the canvas `jobPosting`, bound to a real `job_postings` row.
 *
 * ── THE DECISION THIS MODULE RECORDS ─────────────────────────────────────────────
 * The roadmap left one question open: does a canvas `jobPosting` sync to and from a
 * real `job_postings` row, or do applications stay off-canvas and get read through a
 * different surface? It syncs. The reason is the one `canvas_sync_account` was built
 * for: `jobPosting.applicantCount` is documented as "read from the hiring domain", and
 * the ONLY other way to reach the applications of a card titled "Senior React Engineer"
 * is to match `job_postings.title` against that string — the exact defect FO-A1/FO-A2
 * exist to remove, reappearing one domain over. A count that is wrong because two
 * requisitions were titled alike is worse than no count, because it looks like a fact.
 *
 * So a canvas card carries `postingId` the way an `account` card carries `partyRef`:
 * the id is the identity, the title is a display name, and every read below joins on
 * the former. `job_applications.job_posting_id` is a DECLARED foreign key to
 * `job_postings.id` (0983 widened it to varchar(36) and named the constraint), so the
 * count is an exact join on an indexed column rather than a guess.
 *
 * ── WHY THE COUNT IS AN AGGREGATE AND NOT `listApplications().length` ────────────
 * `listApplications` caps at 200 rows by design — it feeds a board somebody works.
 * Counting its result would report 200 for a posting with 900 applicants and would do
 * it silently, which is the one failure mode a number on a card must not have. These
 * are `count(*)` aggregates.
 *
 * ── ONE WRITER, STILL ────────────────────────────────────────────────────────────
 * {@link syncCanvasPosting} does NOT write `job_postings` itself. `marketplace/
 * jobPostings.ts` is the single writer both publish doors already call, and its own
 * docstring is explicit that a route's job is auth, defaults and response shape and
 * never deciding what a posting IS. This is a third CALLER of that writer, not a third
 * writer: a posting created from a canvas card is the same row the marketplace door
 * would have created, including the one-posting-per-ticket identity rule and every
 * cache the write dirties.
 *
 * ── AND IT RESOLVES BEFORE IT CREATES ────────────────────────────────────────────
 * A card that already carries a `postingId` is REFRESHED, never re-created, and the
 * resolve is by id under the tenant scope. There is deliberately no "find the posting
 * whose title looks like this" path: a card whose id does not resolve says so, and the
 * recruiter decides. Guessing is how one requisition becomes two.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { jobApplications, jobPostings } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ENTRY_STAGE, pipelineRefForPosting } from '../../domain/hiring/pipelineStages';
import {
  BudgetShapeError,
  upsertJobPosting,
  type JobPostingDraft,
} from '../marketplace/jobPostings';
import { AtsError } from './atsError';

/** How many postings one projection read returns. A workspace with more requisitions
 *  than this has a reporting question rather than a board question, and the seat's own
 *  list is the surface for it. */
const LIST_LIMIT = 100;

/**
 * One posting as the canvas reads it.
 *
 * Deliberately NOT the whole `job_postings` row. A card shows what a recruiter acts on;
 * the money band, the screening questions and the attachments belong to the marketplace
 * surfaces that own them, and projecting them here would make the board a second copy
 * of the requisition rather than a handle on it.
 */
export interface CanvasPostingProjection {
  /** `job_postings.id`. The identity — what `postingId` on the card holds, what
   *  `shortlist.postingRef` names, and what `job_pipeline_entries.pipeline_ref` is. */
  postingId: string;
  title: string;
  /** open | closed | filled — the posting's own, verbatim. */
  status: string;
  postingType: string;
  engagementType: string | null;
  discipline: string | null;
  specialty: string | null;
  experienceLevel: string | null;
  visibility: string;
  /** The pipeline a candidate on this posting moves through. Equal to `postingId` by
   *  construction (`pipelineRefForPosting`) — returned rather than re-derived by each
   *  caller, so the canvas never has to know that and keeps working if it stops
   *  being true. */
  pipelineRef: string;
  /** Every application against this posting. The whole point of FO-B3. */
  applicantCount: number;
  /** Applications not yet rejected — who is actually still in play. */
  activeApplicantCount: number;
  /** Still sitting at the entry stage: nobody has looked at them yet. */
  unreviewedCount: number;
  rejectedCount: number;
  /** Where they came from — `job_applications.source`, counted, busiest first. Empty
   *  for a posting with no applications, never a fabricated spread. */
  sources: Array<{ source: string; count: number }>;
  lastApplicationAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of the aggregate read, before it is shaped. */
type PostingCountRow = {
  postingId: string;
  title: string;
  status: string;
  postingType: string;
  engagementType: string | null;
  discipline: string | null;
  specialty: string | null;
  experienceLevel: string | null;
  visibility: string;
  applicantCount: number;
  activeApplicantCount: number;
  unreviewedCount: number;
  rejectedCount: number;
  lastApplicationAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : new Date(value).toISOString();

/**
 * The counts, grouped in ONE read.
 *
 * `filter (where …)` rather than four statements: the three sub-counts are slices of
 * the same join, and issuing them separately is three round-trips whose answers can
 * disagree if an application lands between them. A card reading "12 applicants, 13
 * still active" is a card nobody trusts again.
 *
 * The rejected slice reads `rejected_at` and not `status = 'rejected'`, because
 * `status` is free-form per tenant — a pipeline's stages get renamed constantly —
 * while `rejected_at` is written by `rejectApplication` and by nothing else. The
 * unreviewed slice is the one place a stage NAME is compared, and it compares against
 * the same entry stage the application writer itself uses.
 */
async function readPostingCounts(
  db: Db,
  tenantId: number,
  postingId?: string,
): Promise<PostingCountRow[]> {
  const rows = await db
    .select({
      postingId: jobPostings.id,
      title: jobPostings.title,
      status: jobPostings.status,
      postingType: jobPostings.postingType,
      engagementType: jobPostings.engagementType,
      discipline: jobPostings.discipline,
      specialty: jobPostings.specialty,
      experienceLevel: jobPostings.experienceLevel,
      visibility: jobPostings.visibility,
      createdAt: jobPostings.createdAt,
      updatedAt: jobPostings.updatedAt,
      applicantCount: sql<number>`count(${jobApplications.id})::int`,
      activeApplicantCount: sql<number>`count(${jobApplications.id}) filter (where ${jobApplications.rejectedAt} is null)::int`,
      unreviewedCount: sql<number>`count(${jobApplications.id}) filter (where ${jobApplications.rejectedAt} is null and ${jobApplications.status} = ${ENTRY_STAGE})::int`,
      rejectedCount: sql<number>`count(${jobApplications.id}) filter (where ${jobApplications.rejectedAt} is not null)::int`,
      lastApplicationAt: sql<Date | null>`max(${jobApplications.appliedAt})`,
    })
    .from(jobPostings)
    // Tenant-scoped ON the join as well as in the WHERE. `job_posting_id` is unique per
    // tenant and not globally, so a join that omitted it would count another
    // workspace's applications against this workspace's requisition.
    .leftJoin(jobApplications, and(
      eq(jobApplications.tenantId, jobPostings.tenantId),
      eq(jobApplications.jobPostingId, jobPostings.id),
    ))
    .where(scopedToTenant(
      jobPostings,
      tenantId,
      postingId ? eq(jobPostings.id, postingId) : undefined,
    ))
    .groupBy(
      jobPostings.id, jobPostings.title, jobPostings.status, jobPostings.postingType,
      jobPostings.engagementType, jobPostings.discipline, jobPostings.specialty,
      jobPostings.experienceLevel, jobPostings.visibility,
      jobPostings.createdAt, jobPostings.updatedAt,
    )
    .orderBy(desc(jobPostings.updatedAt))
    .limit(LIST_LIMIT);
  return rows as unknown as PostingCountRow[];
}

/**
 * Source-of-application, per posting.
 *
 * A second grouped read rather than a nested aggregate inside the first: that one is
 * already a four-way `filter` and adding a second grouping level to it produces a
 * statement nobody can read six months later. Both are indexed reads over the same two
 * tables and they run in parallel at every call site.
 */
async function readPostingSources(
  db: Db,
  tenantId: number,
  postingId?: string,
): Promise<Map<string, Array<{ source: string; count: number }>>> {
  const rows = await db
    .select({
      postingId: jobApplications.jobPostingId,
      source: jobApplications.source,
      count: sql<number>`count(*)::int`,
    })
    .from(jobApplications)
    .where(scopedToTenant(
      jobApplications,
      tenantId,
      postingId
        ? eq(jobApplications.jobPostingId, postingId)
        : sql`${jobApplications.jobPostingId} is not null`,
    ))
    .groupBy(jobApplications.jobPostingId, jobApplications.source)
    .orderBy(desc(sql`count(*)`));

  const byPosting = new Map<string, Array<{ source: string; count: number }>>();
  for (const row of rows) {
    if (!row.postingId) continue;
    const list = byPosting.get(row.postingId) ?? [];
    list.push({ source: row.source, count: Number(row.count ?? 0) });
    byPosting.set(row.postingId, list);
  }
  return byPosting;
}

function project(
  row: PostingCountRow,
  sources: Array<{ source: string; count: number }>,
): CanvasPostingProjection {
  return {
    postingId: row.postingId,
    title: row.title,
    status: row.status,
    postingType: row.postingType,
    engagementType: row.engagementType ?? null,
    discipline: row.discipline ?? null,
    specialty: row.specialty ?? null,
    experienceLevel: row.experienceLevel ?? null,
    visibility: row.visibility,
    pipelineRef: pipelineRefForPosting(row.postingId),
    applicantCount: Number(row.applicantCount ?? 0),
    activeApplicantCount: Number(row.activeApplicantCount ?? 0),
    unreviewedCount: Number(row.unreviewedCount ?? 0),
    rejectedCount: Number(row.rejectedCount ?? 0),
    sources,
    lastApplicationAt: iso(row.lastApplicationAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Every posting this workspace holds, with its real application counts.
 *
 * Uncached, deliberately. `listPipelines` caches for 60s because it feeds a board
 * somebody is dragging cards on; this feeds "how many people applied", which is asked
 * precisely when somebody has just been told an application arrived. A minute-old
 * answer to that question is the one that gets acted on.
 */
export async function listCanvasPostings(
  db: Db,
  tenantId: number,
  opts: { status?: string | null } = {},
): Promise<CanvasPostingProjection[]> {
  const [rows, sources] = await Promise.all([
    readPostingCounts(db, tenantId),
    readPostingSources(db, tenantId),
  ]);
  const wanted = typeof opts.status === 'string' && opts.status.trim() ? opts.status.trim() : null;
  return rows
    .filter((row) => !wanted || row.status === wanted)
    .map((row) => project(row, sources.get(row.postingId) ?? []));
}

/** One posting by id, tenant-scoped. `null` for an id this workspace does not own —
 *  the canvas then reports that the card names a posting which no longer resolves,
 *  rather than falling back to a title search. */
export async function readCanvasPosting(
  db: Db,
  tenantId: number,
  postingId: string,
): Promise<CanvasPostingProjection | null> {
  const [rows, sources] = await Promise.all([
    readPostingCounts(db, tenantId, postingId),
    readPostingSources(db, tenantId, postingId),
  ]);
  const row = rows[0];
  return row ? project(row, sources.get(row.postingId) ?? []) : null;
}

export interface SyncCanvasPostingInput {
  tenantId: number;
  actorUserId: string;
  /** The card's own `postingId`, when it has one. Present ⇒ refresh; absent ⇒ create. */
  postingId?: string | null;
  /** What the card holds. Read only on the CREATE path — a refresh never writes the
   *  board's copy back over the record, because the record is the source of truth and
   *  a stale card would silently revert an edit made in the seat. */
  draft?: JobPostingDraft;
}

export interface SyncCanvasPostingResult {
  posting: CanvasPostingProjection;
  /** True when a `job_postings` row was minted by this call. */
  created: boolean;
}

/**
 * Resolve a canvas card to its posting — creating the row the first time.
 *
 * Two paths and no third:
 *   • `postingId` given → read it back. An id that does not resolve is a 404 and NOT a
 *     fall-through to "create a new one": silently minting a second requisition for a
 *     card whose id was mistyped is how a pipeline ends up split across two postings.
 *   • no `postingId` → create through `upsertJobPosting`, then project the fresh row.
 *
 * The result is the projection either way, which is what lets the canvas write the
 * board from the SAME response that performed the write — the rule `canvas_move_deal`
 * introduced to replace a mirroring instruction with a mechanism.
 */
export async function syncCanvasPosting(
  db: Db,
  env: Env,
  input: SyncCanvasPostingInput,
): Promise<SyncCanvasPostingResult> {
  const existingId = typeof input.postingId === 'string' ? input.postingId.trim() : '';
  if (existingId) {
    const posting = await readCanvasPosting(db, input.tenantId, existingId);
    if (!posting) throw new AtsError('No posting in this workspace has that id', 404);
    return { posting, created: false };
  }

  let id: string;
  try {
    const result = await upsertJobPosting(db, env, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      draft: input.draft ?? {},
    });
    id = result.id;
  } catch (error) {
    // Both are the caller's shape being wrong rather than the platform failing, and
    // both already carry a sentence a recruiter can act on. Re-raised as `AtsError` so
    // the route answers them the way it answers every other bad ATS write.
    if (error instanceof BudgetShapeError) throw new AtsError(error.message, 400);
    if (error instanceof Error && error.message === 'title required') {
      throw new AtsError('A posting needs a title before it can be created', 400);
    }
    throw error;
  }

  const posting = await readCanvasPosting(db, input.tenantId, id);
  if (!posting) throw new AtsError('The posting was written but could not be read back', 500);
  return { posting, created: true };
}
