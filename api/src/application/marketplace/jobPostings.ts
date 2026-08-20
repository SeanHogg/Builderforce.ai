/**
 * A job posting's WRITE path — one service, two doors.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────
 * The register recorded it plainly: "Two publish paths exist (`marketplace.publish_ticket`;
 * `POST /api/jobs` with `sourceTicketId`) — could converge." They had drifted exactly
 * the way two copies of a writer always do, and every difference was invisible from
 * either side:
 *
 *   • `POST /api/marketplace/publish` reopened a ticket's PRIOR posting instead of
 *     minting a second one, and kept `tasks.hireable` / `tasks.job_posting_id` in step.
 *     `POST /api/jobs` with the same `sourceTicketId` minted a duplicate every time and
 *     stamped the ticket's back-ref onto whichever one was written last.
 *   • `POST /api/marketplace/publish` defaulted `engagement_type` from the posting type
 *     so the escrow gate could never read an unstated shape as not-fixed-price.
 *     `POST /api/jobs` left it null.
 *   • `POST /api/jobs` validated `discipline` against the vocabulary. The publish route
 *     took whatever string arrived, or derived `designer` from the ticket type.
 *   • Both invalidated the public cache; only one invalidated the per-ticket badge key.
 *
 * So a posting's identity, its shape and its cache freshness all depended on which door
 * it came through, and the MCP tool descriptions cheerfully offered both. This module is
 * the single writer both doors now call: {@link upsertJobPosting}. The routes keep their
 * own jobs — auth, deriving a draft from a ticket, shaping the response — and neither
 * decides what a posting IS any more.
 *
 * ── THE ONE IDENTITY RULE ────────────────────────────────────────────────────────
 * A TICKET OWNS ONE POSTING FOR ITS WHOLE LIFE. Re-publishing a ticket whose posting was
 * closed or filled reopens THAT row rather than minting a replacement, because a
 * replacement orphans the proposals, the evaluations, the invites and the payment
 * schedule already hanging off the original. That rule used to live in one route; it now
 * lives here, which is what makes it true of both.
 *
 * ── BUDGET IS NOT A RATE ─────────────────────────────────────────────────────────
 * `rateMinCents`/`rateMaxCents` are a PER-UNIT band; `budgetTotalCents` is a WHOLE-JOB
 * total. {@link normalizeBudget} is the only place either is read off a request body,
 * and it refuses the combination the DB constraint also refuses — a total on hourly
 * work — rather than writing a row the database will reject with a message nobody can
 * act on. See migration 0985 for the full argument.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { jobPostings, projects, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseJsonArray } from '../../domain/shared/json';
import { hireShape, type EngagementShape } from './engagementShape';
import {
  EXPERIENCE_LEVELS,
  PROJECT_LENGTHS,
  isJobDiscipline,
  isJobSpecialtyOf,
  type ExperienceLevel,
  type ProjectLength,
} from './jobFilters';

// ---------------------------------------------------------------------------
// Cache keys — declared HERE because the writer is here
// ---------------------------------------------------------------------------

/** The open-public browse slice. */
export const JOBS_PUBLIC_CACHE_KEY = 'jobs:public:open';

/** The board badge for one ticket. The tenant MUST be in the key: the loader filters by
 *  tenant, so a key without it lets tenant A's `null` be served to tenant B and back —
 *  cross-tenant cache poisoning on a globally-unique task id. */
export const ticketPostingKey = (tenantId: number, taskId: number | string): string =>
  `gig:ticket-posting:${tenantId}:${taskId}`;

/** How a job is posted. */
export const POSTING_TYPES = ['project_bid', 'design', 'fte'] as const;
export type PostingType = (typeof POSTING_TYPES)[number];

// ---------------------------------------------------------------------------
// Screening questions — validated JSONB, and why
// ---------------------------------------------------------------------------

export const SCREENING_QUESTION_TYPES = ['text', 'yes_no', 'number'] as const;
export type ScreeningQuestionType = (typeof SCREENING_QUESTION_TYPES)[number];

/** A question the employer asks every bidder. */
export interface ScreeningQuestion {
  /** Stable within the posting. An ANSWER is keyed on this, so it is minted once and
   *  preserved across edits — re-minting ids on every save would orphan every answer. */
  id: string;
  prompt: string;
  type: ScreeningQuestionType;
  required: boolean;
}

/** One bidder's answer to one question. */
export interface ScreeningAnswer {
  questionId: string;
  /**
   * The prompt AS ASKED, frozen into the answer.
   *
   * This is the reason the questions are a document and not rows. An employer who
   * rewrites question 3 after ten bids have arrived must not retroactively change what
   * those ten people were asked; carrying the prompt with the answer means the record
   * of the exchange survives any later edit to the posting.
   */
  prompt: string;
  answer: string;
}

/** A file hanging off a posting or a proposal. Metadata pointing at bytes in the
 *  existing `UPLOADS` R2 bucket — never bytes. */
export interface PostingAttachment {
  id: string;
  /** R2 object key under `job-attachments/` or `proposal-attachments/`. */
  key: string;
  name: string;
  mime: string | null;
  size: number;
}

export const MAX_SCREENING_QUESTIONS = 10;
export const MAX_ATTACHMENTS = 10;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** What a brief or a work sample may be. The same list the Brain upload accepts, minus
 *  video: a 100 MB screen recording is not a bid attachment. */
export const ATTACHMENT_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * A claimed question list, normalised.
 *
 * Used on BOTH sides of the column — the writer validates what arrives, and every reader
 * runs the same function over what came back. A row hand-edited into an unreadable shape
 * therefore degrades to "this posting asks nothing" rather than to a 500 on the browse
 * surface, which is the only failure mode worth designing for on a JSONB column.
 *
 * Ids are preserved when the caller supplies one and minted when it does not, so editing
 * the wording of question 3 keeps every answer already given attached to it.
 */
export function normalizeScreeningQuestions(raw: unknown): ScreeningQuestion[] {
  const seen = new Set<string>();
  return parseJsonArray<unknown>(raw)
    .slice(0, MAX_SCREENING_QUESTIONS)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const line = entry as Record<string, unknown>;
      const prompt = text(line.prompt, 500);
      if (!prompt) return [];
      const claimedId = text(line.id, 36);
      // A duplicated id would make two questions share one answer. Mint a fresh one
      // rather than refusing the posting over a copy-paste.
      const id = claimedId && !seen.has(claimedId) ? claimedId : crypto.randomUUID();
      seen.add(id);
      const type = (SCREENING_QUESTION_TYPES as readonly string[]).includes(String(line.type))
        ? (String(line.type) as ScreeningQuestionType)
        : 'text';
      return [{ id, prompt, type, required: line.required === true }];
    });
}

export interface ScreeningAnswerResult {
  answers: ScreeningAnswer[];
  /** Prompts of REQUIRED questions the bidder left blank. The caller decides whether
   *  that is a 400 — this module reports, it does not refuse a bid on its own. */
  missingRequired: string[];
}

/**
 * A claimed answer set, checked against the questions the posting actually asks.
 *
 * Answers to questions that no longer exist are DROPPED rather than kept: they key onto
 * nothing and would render as orphaned prose beside the real answers. Answers arrive
 * keyed by `questionId`, and the prompt is copied from the CURRENT question rather than
 * from the request — the bidder does not get to state what they were asked.
 */
export function normalizeScreeningAnswers(raw: unknown, questions: ScreeningQuestion[]): ScreeningAnswerResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const supplied = new Map<string, string>();
  for (const entry of parseJsonArray<unknown>(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const line = entry as Record<string, unknown>;
    const questionId = text(line.questionId, 36);
    if (!questionId || !byId.has(questionId)) continue;
    const answer = text(line.answer, 2000);
    if (answer) supplied.set(questionId, answer);
  }
  const answers: ScreeningAnswer[] = [];
  const missingRequired: string[] = [];
  // Ordered by the QUESTIONS, not by the request: an employer reads the answers in the
  // order they asked, whatever order the client happened to send them in.
  for (const question of questions) {
    const answer = supplied.get(question.id);
    if (answer) answers.push({ questionId: question.id, prompt: question.prompt, answer });
    else if (question.required) missingRequired.push(question.prompt);
  }
  return { answers, missingRequired };
}

/** A stored attachment list, normalised. Same read-and-write validator as the questions,
 *  for the same reason. */
export function normalizeAttachments(raw: unknown): PostingAttachment[] {
  return parseJsonArray<unknown>(raw)
    .slice(0, MAX_ATTACHMENTS)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const line = entry as Record<string, unknown>;
      const key = text(line.key, 400);
      if (!key) return [];
      const size = Math.floor(Number(line.size ?? 0));
      return [{
        id: text(line.id, 36) || crypto.randomUUID(),
        key,
        name: text(line.name, 200) || 'attachment',
        mime: text(line.mime, 128) || null,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      }];
    });
}

// ---------------------------------------------------------------------------
// The posting's declared shape
// ---------------------------------------------------------------------------

export interface PostingBudget {
  rateMinCents: number | null;
  rateMaxCents: number | null;
  budgetTotalCents: number | null;
}

export class BudgetShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetShapeError';
  }
}

/**
 * The money on a posting, read once.
 *
 * A whole-job total on HOURLY work is refused here rather than left to the DB check
 * constraint, so the caller gets a sentence a person can act on instead of a constraint
 * violation. Everything else is clamped, not refused: a negative rate is a typo, and
 * losing somebody's whole posting over one is worse than reading it as "unstated".
 */
export function normalizeBudget(input: {
  engagementType: EngagementShape | null;
  rateMinCents?: unknown;
  rateMaxCents?: unknown;
  budgetTotalCents?: unknown;
}): PostingBudget {
  const cents = (value: unknown): number | null => {
    if (value == null || value === '') return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const budgetTotalCents = cents(input.budgetTotalCents);
  if (budgetTotalCents !== null && input.engagementType === 'hourly') {
    throw new BudgetShapeError('Hourly work is priced with a rate range, not a total budget.');
  }
  const rateMinCents = cents(input.rateMinCents);
  const rateMaxCents = cents(input.rateMaxCents);
  // A band whose ends are the wrong way round is a slip, not an intention.
  const swapped = rateMinCents !== null && rateMaxCents !== null && rateMinCents > rateMaxCents;
  return {
    rateMinCents: swapped ? rateMaxCents : rateMinCents,
    rateMaxCents: swapped ? rateMinCents : rateMaxCents,
    budgetTotalCents,
  };
}

/** The seniority a posting is pitched at, or null when unstated. */
export const experienceLevel = (value: unknown): ExperienceLevel | null => {
  const claimed = String(value ?? '').trim().toLowerCase();
  return (EXPERIENCE_LEVELS as readonly string[]).includes(claimed) ? (claimed as ExperienceLevel) : null;
};

/** The expected duration, or null when unstated. */
export const projectLength = (value: unknown): ProjectLength | null => {
  const claimed = String(value ?? '').trim().toLowerCase();
  return (PROJECT_LENGTHS as readonly string[]).includes(claimed) ? (claimed as ProjectLength) : null;
};

/** The declared posting type, or the fallback when nothing usable was stated. */
export const postingTypeOf = (value: unknown, fallback: PostingType = 'project_bid'): PostingType =>
  (POSTING_TYPES as readonly string[]).includes(String(value)) ? (String(value) as PostingType) : fallback;

/** The declared posting type, or NULL when nothing usable was stated — what a PATCH
 *  needs, where "not mentioned" and "reset to the default" are opposite instructions. */
export const postingTypeIfStated = (value: unknown): PostingType | null =>
  (POSTING_TYPES as readonly string[]).includes(String(value)) ? (String(value) as PostingType) : null;

/**
 * The (discipline, specialty) pair.
 *
 * A specialty is only meaningful under its parent, so a leaf that does not belong to the
 * discipline being written is dropped rather than stored — a `postgres` design posting
 * would sit in a branch of the browse tree that can never surface it.
 */
export function normalizeCategory(discipline: unknown, specialty: unknown): { discipline: string | null; specialty: string | null } {
  const top = isJobDiscipline(discipline) ? discipline : null;
  const leaf = String(specialty ?? '').trim().toLowerCase();
  return { discipline: top, specialty: top && isJobSpecialtyOf(top, leaf) ? leaf : null };
}

// ---------------------------------------------------------------------------
// The single writer
// ---------------------------------------------------------------------------

/** Everything a posting can carry. Every field optional so the two doors can each
 *  supply what they know and leave the rest to the defaults below. */
export interface JobPostingDraft {
  title?: unknown;
  description?: unknown;
  requirements?: unknown;
  discipline?: unknown;
  specialty?: unknown;
  skills?: unknown;
  postingType?: unknown;
  engagementType?: unknown;
  projectId?: unknown;
  visibility?: unknown;
  currency?: unknown;
  rateMinCents?: unknown;
  rateMaxCents?: unknown;
  budgetTotalCents?: unknown;
  experienceLevel?: unknown;
  projectLength?: unknown;
  screeningQuestions?: unknown;
  attachments?: unknown;
  /** The board ticket this posting is FOR, when there is one. Its presence is what
   *  switches on the one-posting-per-ticket identity rule. */
  sourceTicketId?: unknown;
}

export interface UpsertPostingInput {
  tenantId: number;
  actorUserId: string;
  draft: JobPostingDraft;
  /** Defaults derived from the source ticket by the caller that has one. Applied only
   *  where the draft is silent, so an explicit override always wins. */
  ticketDefaults?: {
    projectId: number | null;
    title: string;
    description: string | null;
    /** `tasks.task_type` — a design ticket becomes a design gig. */
    taskType: string | null;
  };
}

export interface UpsertPostingResult {
  id: string;
  posting: typeof jobPostings.$inferSelect;
  /** True when an EXISTING posting for this ticket was updated or reopened rather than
   *  a new row minted. The caller reports it so "publish" on something published last
   *  quarter is not silently a different act. */
  reused: boolean;
}

const toInt = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
};

/**
 * "This ticket, and only if it is this tenant's."
 *
 * Guarded through the PROJECT rather than through `tasks.tenant_id`, which is nullable
 * (0944 backfilled it but the column still admits NULL) — a scope predicate that silently
 * matches nothing on an older row would leave `hireable` unset with no error to see.
 * Without the guard entirely, any authenticated tenant could stamp a back-ref onto
 * ANOTHER tenant's ticket by guessing its id.
 */
const ticketOwnedBy = (db: Db, tenantId: number, ticketId: number) => and(
  eq(tasks.id, ticketId),
  inArray(tasks.projectId, db.select({ id: projects.id }).from(projects).where(eq(projects.tenantId, tenantId))),
);

/**
 * Create a posting — or, for a ticket that already owns one, update and reopen it.
 *
 * The ONLY writer of `job_postings` on the creation path. Also keeps the ticket's
 * hireable back-ref in step and invalidates every cache the write invalidates, because
 * those were the two things each door remembered differently.
 *
 * Throws {@link BudgetShapeError} for a total attached to hourly work, and
 * `Error('title required')` for a draft with no title once the ticket defaults have
 * been applied. Both are caller-facing 400s.
 */
export async function upsertJobPosting(db: Db, env: Env, input: UpsertPostingInput): Promise<UpsertPostingResult> {
  const { tenantId, actorUserId, draft, ticketDefaults } = input;

  const title = text(draft.title, 200) || ticketDefaults?.title || '';
  if (!title) throw new Error('title required');

  const sourceTicketId = toInt(draft.sourceTicketId);
  const description = typeof draft.description === 'string'
    ? draft.description.slice(0, 5000)
    : (ticketDefaults?.description ?? null);
  const requirements = typeof draft.requirements === 'string' && draft.requirements.trim()
    ? draft.requirements.slice(0, 8000)
    // A gig published from a ticket is scoped by the ticket: its description IS the
    // acceptance criteria a proposal gets evaluated against until somebody writes better.
    : (ticketDefaults?.description ?? null);

  const postingType = postingTypeOf(draft.postingType, ticketDefaults?.taskType === 'design' ? 'design' : 'project_bid');
  // Falls back to the shape the posting type implies, so a posting is never left
  // shapeless — the escrow gate reads an unstated shape as not-fixed-price, which would
  // silently opt these out of the funding check.
  const engagementType = hireShape(draft.engagementType) ?? (postingType === 'fte' ? 'fte' : 'fixed_bid');

  const { discipline, specialty } = normalizeCategory(
    draft.discipline ?? (ticketDefaults?.taskType === 'design' ? 'designer' : undefined),
    draft.specialty,
  );
  const budget = normalizeBudget({
    engagementType,
    rateMinCents: draft.rateMinCents,
    rateMaxCents: draft.rateMaxCents,
    budgetTotalCents: draft.budgetTotalCents,
  });

  const values = {
    tenantId,
    projectId: toInt(draft.projectId) ?? ticketDefaults?.projectId ?? null,
    title,
    description,
    discipline,
    specialty,
    skills: Array.isArray(draft.skills)
      ? JSON.stringify((draft.skills as unknown[]).filter((s) => typeof s === 'string').slice(0, 30))
      : null,
    ...budget,
    currency: typeof draft.currency === 'string' ? draft.currency.slice(0, 3).toUpperCase() : 'USD',
    visibility: draft.visibility === 'private' ? 'private' : 'public',
    postingType,
    engagementType,
    requirements,
    experienceLevel: experienceLevel(draft.experienceLevel),
    projectLength: projectLength(draft.projectLength),
    screeningQuestions: normalizeScreeningQuestions(draft.screeningQuestions),
    attachments: normalizeAttachments(draft.attachments),
    sourceTicketId,
  };

  // ── The identity rule. A ticket owns ONE posting for its whole life. ──────────
  const prior = sourceTicketId == null ? undefined : (await db
    .select()
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, tenantId,
      eq(jobPostings.sourceTicketId, sourceTicketId)))
    .orderBy(desc(jobPostings.updatedAt))
    .limit(1))[0];

  let row: typeof jobPostings.$inferSelect | undefined;
  if (prior) {
    // Re-publishing reopens the row somebody's proposals, evaluations and invites are
    // already attached to. Fields the draft did not state keep what the prior posting
    // said — re-publishing a ticket must not silently blank the rate somebody set.
    [row] = await db.update(jobPostings)
      .set({
        ...values,
        skills: values.skills ?? prior.skills,
        rateMinCents: values.rateMinCents ?? prior.rateMinCents,
        rateMaxCents: values.rateMaxCents ?? prior.rateMaxCents,
        budgetTotalCents: values.budgetTotalCents ?? prior.budgetTotalCents,
        experienceLevel: values.experienceLevel ?? prior.experienceLevel,
        projectLength: values.projectLength ?? prior.projectLength,
        specialty: values.specialty ?? prior.specialty,
        discipline: values.discipline ?? prior.discipline,
        screeningQuestions: values.screeningQuestions.length > 0
          ? values.screeningQuestions
          : normalizeScreeningQuestions(prior.screeningQuestions),
        attachments: values.attachments.length > 0
          ? values.attachments
          : normalizeAttachments(prior.attachments),
        status: 'open',
        closedAt: null,
        updatedAt: new Date(),
      })
      .where(scopedToTenant(jobPostings, tenantId, eq(jobPostings.id, prior.id)))
      .returning();
  } else {
    [row] = await db.insert(jobPostings)
      .values({ ...values, id: crypto.randomUUID(), createdByUserId: actorUserId })
      .returning();
  }
  if (!row) throw new Error('Could not write this posting');

  if (sourceTicketId != null) {
    await db.update(tasks)
      .set({ hireable: true, jobPostingId: row.id })
      .where(ticketOwnedBy(db, tenantId, sourceTicketId));
  }
  await invalidatePostingCaches(env, tenantId, sourceTicketId);
  return { id: row.id, posting: row, reused: Boolean(prior) };
}

/**
 * Every cache a posting write invalidates, in one call.
 *
 * The list used to be re-typed per route and one of them was already short by the
 * per-ticket badge key. Callers that CLOSE a posting (unpublish, PATCH to closed,
 * accepting a proposal) call this too — the browse slice is as wrong after a close as
 * after a create.
 */
export async function invalidatePostingCaches(env: Env, tenantId: number, sourceTicketId?: number | null): Promise<void> {
  await Promise.all([
    invalidateCached(env, JOBS_PUBLIC_CACHE_KEY),
    ...(sourceTicketId == null ? [] : [invalidateCached(env, ticketPostingKey(tenantId, sourceTicketId))]),
  ]);
}

/**
 * The ticket a gig is published FROM, tenant-guarded, with the defaults it supplies.
 *
 * Lives here rather than in the route because "which ticket, and is it this tenant's?"
 * is the same question whichever door asks it, and the answer feeds straight into
 * {@link UpsertPostingInput.ticketDefaults}.
 */
export async function readTicketDefaults(db: Db, tenantId: number, ticketId: number): Promise<UpsertPostingInput['ticketDefaults'] | null> {
  const [t] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      taskType: tasks.taskType,
      projectId: tasks.projectId,
      tenantId: projects.tenantId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, ticketId), eq(projects.tenantId, tenantId)));
  if (!t) return null;
  return {
    projectId: t.projectId == null ? null : Number(t.projectId),
    title: t.title,
    description: t.description ?? null,
    taskType: t.taskType ?? null,
  };
}

/** The tenant's OPEN posting for a ticket, if there is one. The board badge's loader. */
export async function readOpenTicketPosting(db: Db, tenantId: number, ticketId: number) {
  const [row] = await db
    .select()
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, tenantId,
      eq(jobPostings.sourceTicketId, ticketId),
      eq(jobPostings.status, 'open')))
    .limit(1);
  return row ?? null;
}

/** Close a ticket's open posting and clear the ticket's hireable back-ref. */
export async function unpublishTicketPosting(db: Db, env: Env, tenantId: number, ticketId: number): Promise<void> {
  await db
    .update(jobPostings)
    .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(jobPostings, tenantId,
      eq(jobPostings.sourceTicketId, ticketId),
      inArray(jobPostings.status, ['open'])));
  await db.update(tasks)
    .set({ hireable: false, jobPostingId: null })
    .where(ticketOwnedBy(db, tenantId, ticketId));
  await invalidatePostingCaches(env, tenantId, ticketId);
}
