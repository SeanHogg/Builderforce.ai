/**
 * The job board's row shapes — the snake_case column selections and the two
 * row → wire mappers every job query shares. Moved out of the route module
 * (`presentation/routes/jobRoutes.ts`) with the queries that use them, so the
 * HTTP layer no longer selects columns itself.
 *
 * Selections alias every column back to the snake_case key the raw-SQL rows used,
 * because `mapJob` / `mapProposal` (and therefore the wire shape) are keyed on
 * those names.
 */
import { sql } from 'drizzle-orm';
import { jobPostings, jobProposals } from '../../../infrastructure/database/schema';
import { parseJsonArray } from '../../../domain/shared/json';
import { normalizeAttachments, normalizeScreeningQuestions } from '../jobPostings';

/** `job_postings.*` — snake_case keys so `mapJob` keeps reading the same row shape. */
export const jobColumns = {
  id:                 jobPostings.id,
  tenant_id:          jobPostings.tenantId,
  project_id:         jobPostings.projectId,
  title:              jobPostings.title,
  description:        jobPostings.description,
  discipline:         jobPostings.discipline,
  skills:             jobPostings.skills,
  rate_min_cents:     jobPostings.rateMinCents,
  rate_max_cents:     jobPostings.rateMaxCents,
  currency:           jobPostings.currency,
  status:             jobPostings.status,
  visibility:         jobPostings.visibility,
  source_ticket_id:   jobPostings.sourceTicketId,
  posting_type:       jobPostings.postingType,
  engagement_type:    jobPostings.engagementType,
  requirements:       jobPostings.requirements,
  budget_total_cents: jobPostings.budgetTotalCents,
  experience_level:   jobPostings.experienceLevel,
  project_length:     jobPostings.projectLength,
  specialty:          jobPostings.specialty,
  screening_questions: jobPostings.screeningQuestions,
  attachments:        jobPostings.attachments,
  created_by_user_id: jobPostings.createdByUserId,
  closed_at:          jobPostings.closedAt,
  created_at:         jobPostings.createdAt,
  updated_at:         jobPostings.updatedAt,
};

/** `job_proposals.*` — snake_case keys so `mapProposal` keeps reading the same row shape. */
export const proposalColumns = {
  id:                 jobProposals.id,
  job_id:             jobProposals.jobId,
  freelancer_user_id: jobProposals.freelancerUserId,
  cover_note:         jobProposals.coverNote,
  rate_cents:         jobProposals.rateCents,
  currency:           jobProposals.currency,
  status:             jobProposals.status,
  last_eval_overall:  jobProposals.lastEvalOverall,
  decline_reason:     jobProposals.declineReason,
  screening_answers:  jobProposals.screeningAnswers,
  attachments:        jobProposals.attachments,
  created_at:         jobProposals.createdAt,
  updated_at:         jobProposals.updatedAt,
};

/** The employer's two-way reputation, correlated onto a posting's tenant.
 *  `freelancer_reviews.direction` exists in the DB (migration 0299) but is not
 *  modelled in schema.ts, so these stay raw `sql` fragments.
 *  The outer reference is written out as `job_postings.tenant_id` rather than
 *  interpolating the column: drizzle only table-qualifies a column when the
 *  statement has a join, and a bare `tenant_id` would bind to the subquery's own
 *  `r` scope instead of the outer posting. */
export const clientRatingSql = sql<string | null>`(SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.tenant_id = job_postings.tenant_id AND r.direction = 'freelancer_to_employer')`;
export const clientRatingCountSql = sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.tenant_id = job_postings.tenant_id AND r.direction = 'freelancer_to_employer')::int`;

export const mapJob = (r: Record<string, unknown>) => ({
  id: r.id,
  tenantId: Number(r.tenant_id),
  tenantName: r.tenant_name ?? null,
  projectId: r.project_id == null ? null : Number(r.project_id),
  title: r.title,
  description: r.description ?? null,
  discipline: r.discipline ?? null,
  skills: parseJsonArray<string>(r.skills),
  rateMinCents: r.rate_min_cents == null ? null : Number(r.rate_min_cents),
  rateMaxCents: r.rate_max_cents == null ? null : Number(r.rate_max_cents),
  currency: r.currency ?? 'USD',
  status: r.status,
  visibility: r.visibility ?? 'public',
  postingType: r.posting_type ?? 'project_bid',
  engagementType: r.engagement_type ?? null,
  requirements: r.requirements ?? null,
  // 0985. A rate BAND and a whole-job TOTAL are different quantities in different units,
  // so both travel and `engagementType` says which one the reader should believe.
  budgetTotalCents: r.budget_total_cents == null ? null : Number(r.budget_total_cents),
  experienceLevel: r.experience_level ?? null,
  projectLength: r.project_length ?? null,
  specialty: r.specialty ?? null,
  // Re-validated on the way OUT as well as in: a hand-edited JSONB row degrades to "asks
  // nothing" rather than to a 500 on a public browse surface.
  screeningQuestions: normalizeScreeningQuestions(r.screening_questions),
  attachments: normalizeAttachments(r.attachments),
  sourceTicketId: r.source_ticket_id == null ? null : Number(r.source_ticket_id),
  proposalCount: r.proposal_count == null ? undefined : Number(r.proposal_count),
  // The client's (employer's) two-way reputation, so freelancers can vet who they bid with.
  clientRating: r.client_rating == null ? null : Number(r.client_rating),
  clientRatingCount: r.client_rating_count == null ? 0 : Number(r.client_rating_count),
  createdAt: r.created_at ?? null,
});

export const mapProposal = (r: Record<string, unknown>) => ({
  id: r.id,
  jobId: r.job_id,
  jobTitle: r.job_title ?? null,
  freelancerUserId: r.freelancer_user_id,
  freelancerName: r.freelancer_name ?? null,
  coverNote: r.cover_note ?? null,
  rateCents: r.rate_cents == null ? null : Number(r.rate_cents),
  currency: r.currency ?? 'USD',
  status: r.status,
  lastEvalOverall: r.last_eval_overall == null ? null : Number(r.last_eval_overall),
  declineReason: r.decline_reason ?? null,
  /** The bidder's answers to the posting's screening questions, each carrying the prompt
   *  AS ASKED so a later edit to the posting cannot rewrite the question retroactively. */
  screeningAnswers: parseJsonArray(r.screening_answers),
  attachments: normalizeAttachments(r.attachments),
  /** The schedule this bidder counter-proposed, when the caller asked for one. Absent
   *  (rather than empty) on the surfaces that do not read it, so a caller can tell
   *  "no schedule proposed" from "schedules not loaded". */
  milestones: r.milestones ?? undefined,
  createdAt: r.created_at ?? null,
});
