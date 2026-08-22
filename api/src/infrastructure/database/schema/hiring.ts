/**
 * Schema — Hiring, owned by the **Recruiter** (PRD 20 §3).
 *
 * Root entity `job_posting`. 79 source tables in → 27 out: 38 absorbed by the
 * kernel, 1 by the canvas, 10 merged into a sibling. hired.video contributed 24
 * of the 27 survivors — this domain is the clearest case of "redundant by shape,
 * complementary by domain": three products overlapped on shape almost completely
 * and on capability barely at all.
 *
 * WHAT IS NOT HERE, AND WHY. A candidate's comments, a pipeline's members, an
 * interview's recording, a scorecard's questions and answers, an offer's share
 * link, an application's activity trail — none of them earn a table. They are
 * `annotations`, `memberships`, `artifacts`, `question_sets` + `responses`,
 * `share_links` and `activity_log` rows. `recruiter_deals` collapsed into
 * `deal` (§3.3): a placement fee is a deal, carrying the same `pipeline_id`,
 * stage, owner and fee. `recruiter_outreach_enrollments` collapsed into the
 * sequence `enrollment` alongside three siblings that were all person +
 * sequence + status + `current_step` + `next_send_at`.
 *
 * NO SIBLING IMPORTS. Cross-domain references are plain columns; the foreign key
 * is declared in the migration. That is the domain boundary of §3 made
 * mechanical rather than aspirational — `check-domain-boundary.mjs` counts the
 * edges, and this module adds none.
 *
 * See migration 0419.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { objects } from './kernel';

// =========================================================================
// The root entity, and the family that hangs off it.
//
// `DOMAIN_MANIFEST` names `job_posting` as this seat’s rootKind, and until the
// module move these four tables were declared in `agents.ts` — a seat whose own
// root table lived in somebody else’s file, which is the one shape §3 exists to
// forbid. It cost a constraint in the Drizzle schema: `jobApplications` could not
// declare `.references(() => jobPostings.id)` without making hiring import agents,
// so the single most important join in the ATS was a bare column. It can now, and does.
//
// Cross-domain columns travelled as PLAIN IDS (`tenant_id`, `project_id`,
// `source_ticket_id`, the `*_user_id`s) rather than as `.references()`, which is
// this module’s standing convention and §3’s rule both — the foreign keys are
// declared in migrations 0273 / 0293 / 0985 and are unaffected.
// `check-domain-root-table.mjs` keeps a rootKind and its module together from here.
// =========================================================================

// ---------------------------------------------------------------------------
// Freelance marketplace — two-sided (0273): job postings + proposals (bidding),
// reviews/reputation, invoices/payment status, in-app notifications.
// ---------------------------------------------------------------------------

/** An employer posts work freelancers can BID on (distinct from a direct hire). */
export const jobPostings = pgTable('job_postings', {
  id:               varchar('id', { length: 36 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull(),
  projectId:        integer('project_id'),
  title:            varchar('title', { length: 200 }).notNull(),
  description:      text('description'),
  discipline:       varchar('discipline', { length: 60 }),
  skills:           text('skills'),                        // JSON string[]
  rateMinCents:     integer('rate_min_cents'),
  rateMaxCents:     integer('rate_max_cents'),
  currency:         varchar('currency', { length: 3 }).notNull().default('USD'),
  status:           varchar('status', { length: 20 }).notNull().default('open'),      // open|closed|filled
  visibility:       varchar('visibility', { length: 10 }).notNull().default('public'), // public|private
  /** Gig Marketplace (0293): the work item this gig was published FROM (one-click
   *  "Publish to Marketplace"), the gig shape, the billing/engagement shape, and the
   *  free-text acceptance criteria a proposal is AI-evaluated against. */
  sourceTicketId:   integer('source_ticket_id'),
  postingType:      varchar('posting_type', { length: 20 }).notNull().default('project_bid'), // project_bid|design|fte
  engagementType:   varchar('engagement_type', { length: 20 }),                        // fixed_bid|hourly|fte
  requirements:     text('requirements'),
  /** ── RICHER POSTING (0985) ───────────────────────────────────────────────────
   *
   *  BUDGET vs RATE. `rate_min_cents`/`rate_max_cents` are a PER-UNIT rate BAND —
   *  "$80–$120 an hour". `budget_total_cents` is the WHOLE-JOB total for fixed-price
   *  work — "$6,000 for the thing". They are different units of a different quantity
   *  and the same number means opposite things in each, so they are separate columns
   *  with unit-bearing names rather than one pair reinterpreted by context.
   *  `engagement_type` already says which shape the work is (0293) and therefore which
   *  column a reader looks at; a DB CHECK forbids the one combination that is a
   *  category error (a whole-job total on hourly work). No `job_type` column is added:
   *  hourly-vs-fixed is `engagement_type` and adding a second spelling of it would be
   *  the same fact in two places. */
  budgetTotalCents: integer('budget_total_cents'),
  /** entry|intermediate|expert — the seniority the posting is pitched at. */
  experienceLevel:  varchar('experience_level', { length: 20 }),
  /** lt_1_month|1_3_months|3_6_months|gt_6_months|ongoing — expected duration. */
  projectLength:    varchar('project_length', { length: 24 }),
  /** The SUB-CATEGORY beneath `discipline`. The vocabulary is a DATA registry
   *  (`JOB_SPECIALTIES` in application/marketplace/jobFilters.ts), so deepening the
   *  category tree adds registry rows and never a migration per level. */
  specialty:        varchar('specialty', { length: 60 }),
  /** `ScreeningQuestion[]` — validated JSONB, not rows. The questions have no life
   *  outside the posting (never joined, never filtered on), the list is bounded, and
   *  an answer freezes the prompt it answered, so a later edit cannot silently re-key
   *  bids that are already in. See `jobPostings.ts` for the validator. */
  screeningQuestions: jsonb('screening_questions'),
  /** `PostingAttachment[]` — `{ id, key, name, mime, size }` naming objects in the
   *  EXISTING `UPLOADS` R2 bucket. No new blob store: the same bucket and the same
   *  put/get shape the résumé and avatar uploads already use. */
  attachments:      jsonb('attachments'),
  createdByUserId:  varchar('created_by_user_id', { length: 36 }),
  closedAt:         timestamp('closed_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byStatus: index('idx_job_postings_open').on(t.status),
  byTenant: index('idx_job_postings_tenant').on(t.tenantId),
}));


/** A freelancer's bid on a job. One live proposal per (job, freelancer). */
export const jobProposals = pgTable('job_proposals', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  jobId:             varchar('job_id', { length: 36 }).notNull().references(() => jobPostings.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull(),
  coverNote:         text('cover_note'),
  rateCents:         integer('rate_cents'),
  currency:          varchar('currency', { length: 3 }).notNull().default('USD'),
  status:            varchar('status', { length: 20 }).notNull().default('submitted'), // submitted|shortlisted|accepted|declined|withdrawn
  /** Gig Marketplace (0293): 0..100 cached overall from the latest AI proposal
   *  evaluation (list display), and the courteous decline message shown to the
   *  candidate when they aren't selected. */
  lastEvalOverall:   integer('last_eval_overall'),
  declineReason:     text('decline_reason'),
  /** ── RICHER PROPOSAL (0985) ──────────────────────────────────────────────────
   *  `ScreeningAnswer[]` — one per question the posting asked, keyed by the question's
   *  id AND carrying a frozen copy of the prompt. The frozen copy is the point: an
   *  employer who edits question 3 after ten bids arrived must not retroactively change
   *  what those ten people were asked. */
  screeningAnswers:  jsonb('screening_answers'),
  /** `PostingAttachment[]` — same shape and same R2 bucket as the posting's own. */
  attachments:       jsonb('attachments'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFreelancer: index('idx_proposals_freelancer').on(t.freelancerUserId),
}));


/**
 * A client's SHORTLIST of freelancers (0985) — the supply-side mirror of
 * `job_proposals.status = 'saved'`, which is how the seeker shortlists work.
 *
 * A join and nothing else: the row IS the relationship. `list_name` lets one workspace
 * keep several shortlists ("react leads", "backup DBAs") without a lists table nobody
 * would ever query on its own — a new list is a value, not a schema change, which is
 * the register's rule that a new KIND is a column value.
 *
 * `owner_user_id` as well as `tenant_id` because a shortlist is a PERSON's working set:
 * two hiring managers in one workspace keep separate lists, and merging them silently
 * would be indistinguishable from a leak between them.
 */
export const savedTalent = pgTable('saved_talent', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  tenantId:          integer('tenant_id').notNull(),
  ownerUserId:       varchar('owner_user_id', { length: 36 }).notNull(),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull(),
  listName:          varchar('list_name', { length: 80 }).notNull().default('shortlist'),
  note:              text('note'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqSavedTalent: uniqueIndex('uq_saved_talent').on(t.tenantId, t.ownerUserId, t.freelancerUserId, t.listName),
  byOwner:       index('idx_saved_talent_owner').on(t.tenantId, t.ownerUserId, t.listName),
}));


/**
 * An INVITATION to one named freelancer to bid on one posting (0985).
 *
 * Deliberately NOT a notification. A notification is a message that has been read or
 * not; an invite is a state machine with a counterparty, an expiry and an outcome, and
 * accepting one lands the invitee INSIDE the proposal flow rather than at a dead end —
 * `proposal_id` records the `job_proposals` row the acceptance opened, which is the
 * whole difference. The notification is still sent, through `notify()` like every other
 * marketplace event, but it is the announcement of this row and not the row itself.
 *
 * A live invite is also a GRANT: it is what lets an invited freelancer bid on a
 * `visibility = 'private'` posting they could not otherwise see (see the private-job
 * gate in `POST /api/jobs/:id/proposals`). That is why it is tenant-scoped and why the
 * expiry is real — a grant with no end is an access-control decision nobody revisits.
 */
export const jobInvites = pgTable('job_invites', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  tenantId:          integer('tenant_id').notNull(),
  jobId:             varchar('job_id', { length: 36 }).notNull().references(() => jobPostings.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull(),
  invitedByUserId:   varchar('invited_by_user_id', { length: 36 }),
  message:           text('message'),
  /** sent|viewed|accepted|declined|expired */
  status:            varchar('status', { length: 20 }).notNull().default('sent'),
  expiresAt:         timestamp('expires_at'),
  viewedAt:          timestamp('viewed_at'),
  respondedAt:       timestamp('responded_at'),
  /** The bid this invite turned into. SET NULL rather than CASCADE: withdrawing a
   *  proposal must not erase the record that the client invited this person. */
  proposalId:        varchar('proposal_id', { length: 36 }).references(() => jobProposals.id, { onDelete: 'set null' }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqJobInvite:  uniqueIndex('uq_job_invites_job_user').on(t.jobId, t.freelancerUserId),
  byInvitee:    index('idx_job_invites_invitee').on(t.freelancerUserId, t.status),
  byTenant:     index('idx_job_invites_tenant').on(t.tenantId, t.createdAt),
}));


// ── Agentic Workforce Kanban: roles, templates & per-lane requirements (0274) ─
// One primitive — a KanbanTemplate binding {roles, required checks, gate} to each
// lane — powers the built-in Standard SWE board, custom kanbans, the recommended
// roster, per-ticket auditing, and swimlane gating. Built-in roles/templates live
// as TS constants; these tables hold only tenant-created/forked/published rows.

/** Tenant-extensible tail of the job-function role taxonomy (canonical set in code). */
export const jobRoles = pgTable('job_roles', {
  id:          varchar('id', { length: 36 }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  key:         varchar('key', { length: 60 }).notNull(),
  name:        varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  discipline:  varchar('discipline', { length: 60 }).notNull().default('engineering'),
  color:       varchar('color', { length: 24 }),
  icon:        varchar('icon', { length: 16 }),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


/** A person's application to a posting. The root of the hiring funnel. */
export const jobApplications = pgTable('job_applications', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /**
   * The posting applied to — `job_postings.id`, which is `varchar(36)`.
   *
   * It was `integer` from 0419 until 0983, and that single word is why this table had no
   * writer for four months. The ATS half of hiring was designed integer-keyed against
   * string `candidate_ref`s; the marketplace half (0273/0293) was designed uuid-keyed;
   * the two were built independently and an application therefore could not name the
   * posting it was an application TO. `admitCandidate` sidestepped it by writing only
   * `party_roles` and `candidate_resumes`, which is how applying came to create a
   * candidate but not an application.
   *
   * Widened rather than bridged. The alternative on the table was matching postings by
   * title, and string matching between two identifier spaces is the exact defect
   * `candidateIntake.ts` already documents removing from the party module. See 0983.
   *
   * DECLARED, not merely intended. This was a bare column for as long as `job_postings`
   * lived in `agents.ts`, because declaring the reference would have made hiring import
   * agents. The posting is in this module now, so the reference is in the schema — matching
   * `fk_job_applications_posting` (ON DELETE SET NULL), which migration 0983 already put
   * on the database.
   */
  jobPostingId: varchar('job_posting_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
  /** party_roles.party_ref for the candidate role — a person, not a candidate row. */
  candidateRef: varchar('candidate_ref', { length: 64 }).notNull(),
  source:       varchar('source', { length: 48 }).notNull().default('direct'),
  /** Free-form: a pipeline's stages define the funnel, exactly as a board's
   *  swimlanes define a task's status. */
  status:       varchar('status', { length: 48 }).notNull().default('applied'),
  coverLetter:  text('cover_letter'),
  resumeRef:    uuid('resume_ref'),
  score:        numeric('score', { precision: 5, scale: 2 }),
  rejectedAt:   timestamp('rejected_at'),
  rejectReason: varchar('reject_reason', { length: 160 }),
  appliedAt:    timestamp('applied_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_job_applications_candidate').on(t.tenantId, t.jobPostingId, t.candidateRef),
  index('idx_job_applications_status').on(t.tenantId, t.status, t.appliedAt),
]);

/** A résumé as stored and parsed. The file itself is an `artifact`; this is the
 *  structured extraction the matcher reads. */
export const candidateResumes = pgTable('candidate_resumes', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull(),
  candidateRef: varchar('candidate_ref', { length: 64 }).notNull(),
  artifactId:   uuid('artifact_id'),
  headline:     varchar('headline', { length: 300 }),
  parsed:       jsonb('parsed'),
  skills:       jsonb('skills'),
  yearsExp:     numeric('years_exp', { precision: 4, scale: 1 }),
  isPrimary:    boolean('is_primary').notNull().default(false),
  parsedAt:     timestamp('parsed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_candidate_resumes_candidate').on(t.tenantId, t.candidateRef, t.isPrimary),
  // One snapshot per candidate per employer (0471). Applying REFRESHES what this person
  // applies with rather than appending a near-identical copy per application, which is
  // also what makes the projection safely idempotent.
  uniqueIndex('uq_candidate_resumes_tenant_candidate').on(t.tenantId, t.candidateRef),
]);

/** Every touch with a candidate, whoever made it — recruiter, agent or automation. */
export const candidateInteractions = pgTable('candidate_interactions', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  candidateRef: varchar('candidate_ref', { length: 64 }).notNull(),
  /** 'call' | 'email' | 'message' | 'meeting' | 'note' | 'view'. */
  channel:      varchar('channel', { length: 24 }).notNull(),
  direction:    varchar('direction', { length: 12 }).notNull().default('outbound'),
  actorRef:     varchar('actor_ref', { length: 64 }),
  subject:      varchar('subject', { length: 300 }),
  body:         text('body'),
  outcome:      varchar('outcome', { length: 48 }),
  occurredAt:   timestamp('occurred_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_candidate_interactions_candidate').on(t.tenantId, t.candidateRef, t.occurredAt),
]);

/** One candidate's position in one pipeline. The join that makes a funnel report
 *  a single query rather than a fan-out across per-stage tables. */
export const jobPipelineEntries = pgTable('job_pipeline_entries', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  applicationId: integer('application_id'),
  candidateRef:  varchar('candidate_ref', { length: 64 }).notNull(),
  pipelineRef:   varchar('pipeline_ref', { length: 64 }).notNull(),
  stage:         varchar('stage', { length: 48 }).notNull(),
  /** Where this candidate came from, stamped from the application when the entry
   *  is created and never updated. Denormalised deliberately and with a single
   *  writer: source-of-hire conversion is the report a recruiter is measured on,
   *  and joining back to the application per stage transition is exactly the
   *  fan-out this column exists to avoid. (0460) */
  source:        varchar('source', { length: 48 }),
  position:      integer('position').notNull().default(0),
  enteredAt:     timestamp('entered_at').notNull().defaultNow(),
  exitedAt:      timestamp('exited_at'),
  daysInStage:   integer('days_in_stage'),
  ownerRef:      varchar('owner_ref', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_job_pipeline_entries_stage').on(t.tenantId, t.pipelineRef, t.stage, t.position),
  /** The BOARD's read: one pipeline's still-open entries, in order (0983). The full
   *  index above answers "what happened in this stage"; a board asks "who is live", and
   *  every entry that ever exited is noise it would otherwise scan past. */
  index('idx_job_pipeline_entries_open').on(t.tenantId, t.pipelineRef, t.position).where(sql`exited_at IS NULL`),
]);

/** The stages a pipeline moves through. A lookup with an order, not an enum:
 *  every tenant renames these. */
export const interviewKits = pgTable('interview_kits', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  roleFamily:  varchar('role_family', { length: 96 }),
  description: text('description'),
  isDefault:   boolean('is_default').notNull().default(false),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_interview_kits_name').on(t.tenantId, t.name),
]);

/** An ordered stage within a kit — what happens, who runs it, how long. */
export const interviewKitStages = pgTable('interview_kit_stages', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  kitId:      integer('kit_id').references(() => interviewKits.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 160 }).notNull(),
  /** 'screen' | 'technical' | 'panel' | 'take_home' | 'reference' | 'offer'. */
  kind:       varchar('kind', { length: 32 }).notNull().default('screen'),
  position:   integer('position').notNull().default(0),
  durationMin: integer('duration_min'),
  /** The scorecard is a `question_sets` row; this is only the pointer. */
  scorecardId: uuid('scorecard_id'),
  /** Who runs this stage, as member refs. An ordered list read only with the stage
   *  and never queried independently, which is the stated bar for holding a thin list
   *  as an array rather than a join table. Required by candidate self-scheduling: it is
   *  the panel whose calendars a proposed slot must clear, and taking it from the
   *  request instead would let a caller book against an empty panel. (0460) */
  interviewerRefs: jsonb('interviewer_refs').notNull().default('[]'),
  guidance:   text('guidance'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_interview_kit_stages_pos').on(t.kitId, t.position),
]);

/** A scheduled or completed interview. Participants are `memberships`; the
 *  recording and transcript are `artifacts` derived from one another. */
export const interviews = pgTable('interviews', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  applicationId: integer('application_id'),
  kitStageId:    integer('kit_stage_id'),
  candidateRef:  varchar('candidate_ref', { length: 64 }).notNull(),
  scheduledAt:   timestamp('scheduled_at'),
  startedAt:     timestamp('started_at'),
  endedAt:       timestamp('ended_at'),
  /** 'scheduled' | 'live' | 'completed' | 'no_show' | 'cancelled'. */
  status:        varchar('status', { length: 16 }).notNull().default('scheduled'),
  /** 'live' | 'async' — an async interview is the same row with no attendees. */
  mode:          varchar('mode', { length: 12 }).notNull().default('live'),
  meetingUrl:    text('meeting_url'),
  recordingId:   uuid('recording_id'),
  overallScore:  numeric('overall_score', { precision: 5, scale: 2 }),
  /** ── Candidate self-scheduling (0460) ────────────────────────────────────
   *  The solver, free/busy merge and calendar sync already existed and were wired
   *  to internal meetings only; these four columns are the EXTERNAL half. The
   *  token itself is a `share_links` row — a booking link is a scoped external
   *  link, and reusing the primitive means expiry, revocation and use-counting
   *  are already built. */
  bookingShareId:    uuid('booking_share_id'),
  /** IANA zone. Required before a slot is proposed: 9am in the recruiter's zone
   *  is 3am in the candidate's, and the solver is timezone-correct only when it is
   *  told which timezone to be correct about. */
  candidateTimezone: varchar('candidate_timezone', { length: 64 }),
  /** The slots OFFERED, as [{startISO, endISO}]. Stored rather than recomputed:
   *  the offer is a promise, and "that time is no longer available" after the
   *  candidate clicked is the worst moment in a candidate experience. Availability
   *  is re-checked at booking AGAINST this list, not instead of it. */
  offeredSlots:      jsonb('offered_slots').notNull().default('[]'),
  bookedAt:          timestamp('booked_at'),
  /** `status` already carries 'no_show'; this is WHEN, which is what a no-show
   *  rate is computed from. */
  noShowAt:          timestamp('no_show_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_interviews_schedule').on(t.tenantId, t.status, t.scheduledAt),
  index('idx_interviews_candidate').on(t.tenantId, t.candidateRef),
]);

/**
 * Self-identified EEO / diversity responses, SEGREGATED from everything that
 * evaluates a candidate.
 *
 * The separation is the requirement, not a modelling preference: this data is
 * collected because statutory reporting demands it and is unlawful to use in an
 * assessment, and both rules cannot hold for a column sitting in
 * `party_roles.attrs` beside the fit score. A separate table can be granted
 * separately, joined deliberately, aggregated without identifiers and dropped on
 * its own clock. The canvas marks the matching field `restricted`, which is what
 * keeps it out of the model that ranks the shortlist. See migration 0460.
 */
export const candidateDemographics = pgTable('candidate_demographics', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  candidateRef: varchar('candidate_ref', { length: 64 }).notNull(),
  /** Set by whichever regulator the tenant reports to, so a lookup with a fixed
   *  order would be wrong: 'gender' | 'ethnicity' | 'disability' | 'veteran' | … */
  category:     varchar('category', { length: 48 }).notNull(),
  response:     varchar('response', { length: 160 }).notNull(),
  /** 'self' | 'imported' | 'observed'. Anything but 'self' is a compliance defect —
   *  observed demographics are not self-identification, and recording which it was
   *  is what makes that auditable rather than assumed. */
  source:       varchar('source', { length: 16 }).notNull().default('self'),
  collectedAt:  timestamp('collected_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_candidate_demographics').on(t.tenantId, t.candidateRef, t.category),
  index('idx_candidate_demographics_candidate').on(t.tenantId, t.candidateRef),
]);

/** A reusable bank of interview questions, grouped for a role. The asked
 *  questions and their answers are `question_sets` and `responses`. */
export const interviewQuestionSets = pgTable('interview_question_sets', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  roleFamily: varchar('role_family', { length: 96 }),
  seniority:  varchar('seniority', { length: 32 }),
  questions:  jsonb('questions').notNull().default('[]'),
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_interview_question_sets_name').on(t.tenantId, t.name),
]);

/** A dimension a scorecard scores on, with its weight. Kept as a table rather
 *  than a JSON key because reports aggregate ACROSS scorecards by attribute. */
export const scorecardAttributes = pgTable('scorecard_attributes', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  scorecardId: uuid('scorecard_id'),
  key:         varchar('key', { length: 96 }).notNull(),
  label:       varchar('label', { length: 200 }).notNull(),
  weight:      numeric('weight', { precision: 5, scale: 2 }).notNull().default('1'),
  scaleMin:    integer('scale_min').notNull().default(1),
  scaleMax:    integer('scale_max').notNull().default(5),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_scorecard_attributes_key').on(t.tenantId, t.scorecardId, t.key),
]);

/** An item on a screening template — the question, and what disqualifies. */
export const screeningTemplateItems = pgTable('screening_template_items', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  templateId:  uuid('template_id'),
  prompt:      text('prompt').notNull(),
  /** 'boolean' | 'number' | 'choice' | 'text'. */
  answerType:  varchar('answer_type', { length: 16 }).notNull().default('text'),
  choices:     jsonb('choices'),
  /** A knockout answer rejects without a human reading it. */
  knockout:    jsonb('knockout'),
  required:    boolean('required').notNull().default(false),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_screening_template_items_pos').on(t.templateId, t.position),
]);

/** The decision, with who made it and on what evidence. Separate from the
 *  application's status because a status can be re-driven; a decision is a
 *  record that someone is accountable for. */
export const hiringDecisions = pgTable('hiring_decisions', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  applicationId: integer('application_id'),
  candidateRef:  varchar('candidate_ref', { length: 64 }).notNull(),
  /** 'advance' | 'reject' | 'hold' | 'offer' | 'hire'. */
  decision:      varchar('decision', { length: 24 }).notNull(),
  deciderRef:    varchar('decider_ref', { length: 64 }),
  rationale:     text('rationale'),
  evidence:      jsonb('evidence'),
  decidedAt:     timestamp('decided_at').notNull().defaultNow(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_hiring_decisions_application').on(t.applicationId, t.decidedAt),
  /** The candidate drawer reads a person's decision history, and `application_id` is
   *  null for anyone sourced straight into a pipeline rather than through a posting
   *  (0983). Indexing only the application would leave those unreachable by index. */
  index('idx_hiring_decisions_candidate').on(t.tenantId, t.candidateRef, t.decidedAt),
]);

/** An offer, from draft to signature. The rendered letter is an `artifact`; the
 *  signing link is a `share_link`. */
export const offerLetters = pgTable('offer_letters', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  applicationId: integer('application_id'),
  candidateRef:  varchar('candidate_ref', { length: 64 }).notNull(),
  title:         varchar('title', { length: 200 }).notNull(),
  baseSalary:    numeric('base_salary', { precision: 14, scale: 2 }),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  equity:        varchar('equity', { length: 96 }),
  startDate:     timestamp('start_date'),
  /** 'draft' | 'approved' | 'sent' | 'accepted' | 'declined' | 'expired'. */
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  /**
   * The `signature_requests` row this offer was sent as — the ONE answer to "is it
   * signed" (0983).
   *
   * Stored as a column rather than a key inside `terms` for the same reason
   * `legal_document_files.signature_request_id` is: it is the guard that makes sending
   * idempotent. An offer whose request id is already set cannot be sent again, so one
   * offer can never have two signature requests and therefore never two conflicting
   * answers about whether the candidate signed. The signing LINK is still a
   * `share_links` row minted by the engine; this is only the pointer to the request.
   */
  signatureRequestId: integer('signature_request_id'),
  expiresAt:     timestamp('expires_at'),
  sentAt:        timestamp('sent_at'),
  respondedAt:   timestamp('responded_at'),
  terms:         jsonb('terms'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_offer_letters_status').on(t.tenantId, t.status, t.sentAt),
  /**
   * ONE live offer per candidate per application (0983).
   *
   * The application layer refuses a second draft; this is the same rule where it cannot
   * be raced by two recruiters clicking at once. PARTIAL deliberately: an offer that was
   * declined and then re-made at a higher number is a negotiation, not a duplicate, so
   * only the states that mean "this offer is live" are constrained.
   */
  uniqueIndex('uq_offer_letters_open')
    .on(t.tenantId, t.applicationId, t.candidateRef)
    .where(sql`status IN ('draft', 'approved', 'sent')`),
]);

/** A completed placement — the revenue event hiring exists to produce. */
export const placements = pgTable('placements', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  candidateRef: varchar('candidate_ref', { length: 64 }).notNull(),
  clientRef:    varchar('client_ref', { length: 64 }),
  jobPostingId: integer('job_posting_id'),
  /** 'permanent' | 'contract' | 'temp_to_perm'. */
  kind:         varchar('kind', { length: 24 }).notNull().default('permanent'),
  startDate:    timestamp('start_date'),
  endDate:      timestamp('end_date'),
  salary:       numeric('salary', { precision: 14, scale: 2 }),
  feePercent:   numeric('fee_percent', { precision: 5, scale: 2 }),
  feeAmount:    numeric('fee_amount', { precision: 14, scale: 2 }),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'pending' | 'active' | 'guarantee' | 'completed' | 'fallen_through'. */
  status:       varchar('status', { length: 24 }).notNull().default('pending'),
  guaranteeEndsAt: timestamp('guarantee_ends_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_placements_status').on(t.tenantId, t.status, t.startDate),
]);

/** How a placement fee divides between recruiters or firms. */
export const placementSplits = pgTable('placement_splits', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  placementId: integer('placement_id').references(() => placements.id, { onDelete: 'cascade' }),
  partyKind:   varchar('party_kind', { length: 16 }).notNull().default('user'),
  partyRef:    varchar('party_ref', { length: 64 }).notNull(),
  /** 'sourcer' | 'closer' | 'account' | 'firm'. */
  role:        varchar('role', { length: 24 }).notNull(),
  percent:     numeric('percent', { precision: 5, scale: 2 }).notNull(),
  amount:      numeric('amount', { precision: 14, scale: 2 }),
  /** The payout itself is a `ledger_entries` row; this is the entitlement. */
  settledAt:   timestamp('settled_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_placement_splits_party').on(t.placementId, t.partyKind, t.partyRef, t.role),
]);

/** A document a placement legally requires — right to work, contract, DBS. */
export const placementDocuments = pgTable('placement_documents', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  placementId: integer('placement_id').references(() => placements.id, { onDelete: 'cascade' }),
  kind:        varchar('kind', { length: 48 }).notNull(),
  artifactId:  uuid('artifact_id'),
  /** 'required' | 'received' | 'verified' | 'expired' | 'waived'. */
  status:      varchar('status', { length: 16 }).notNull().default('required'),
  expiresAt:   timestamp('expires_at'),
  verifiedBy:  varchar('verified_by', { length: 64 }),
  verifiedAt:  timestamp('verified_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_placement_documents_kind').on(t.placementId, t.kind),
]);

/** An outplacement package offered to a leaver — the bridge between People and
 *  Hiring, and the reason `outplacement_enrollments` collapsed into the shared
 *  sequence `enrollment` (§3.3). */
export const outplacementPackages = pgTable('outplacement_packages', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  durationDays: integer('duration_days').notNull().default(90),
  entitlements: jsonb('entitlements'),
  seatCount:   integer('seat_count').notNull().default(0),
  seatsUsed:   integer('seats_used').notNull().default(0),
  active:      boolean('active').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_outplacement_packages_name').on(t.tenantId, t.name),
]);

/** A retained search firm working a role on the tenant's behalf. */
export const retainedSearchFirms = pgTable('retained_search_firms', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  contactEmail: varchar('contact_email', { length: 320 }),
  /** Their cut, before `placement_splits` divides the rest. */
  feePercent:  numeric('fee_percent', { precision: 5, scale: 2 }),
  retainerAmount: numeric('retainer_amount', { precision: 14, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  specialisms: jsonb('specialisms'),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_retained_search_firms_name').on(t.tenantId, t.name),
]);

/** A named outreach sequence. Enrolments are the shared kernel-adjacent
 *  `enrollment` row (§3.3); this is only the definition. */
export const recruiterOutreachSequences = pgTable('recruiter_outreach_sequences', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  /** Each step: channel, delay, template. Never filtered on independently, so it
   *  is JSON rather than a child table (§3.1, the thin-table move). */
  steps:       jsonb('steps').notNull().default('[]'),
  audience:    jsonb('audience'),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_recruiter_outreach_sequences_name').on(t.tenantId, t.name),
]);

/** A follow-up the recruiting agent owes somebody. The agent's own run is a
 *  `runs` row; this is the commitment that outlives it. */
export const recruiterAgentFollowups = pgTable('recruiter_agent_followups', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  candidateRef: varchar('candidate_ref', { length: 64 }),
  applicationId: integer('application_id'),
  reason:       varchar('reason', { length: 160 }).notNull(),
  dueAt:        timestamp('due_at').notNull(),
  /** 'pending' | 'sent' | 'skipped' | 'cancelled'. */
  status:       varchar('status', { length: 16 }).notNull().default('pending'),
  draft:        text('draft'),
  sentAt:       timestamp('sent_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_recruiter_agent_followups_due').on(t.tenantId, t.status, t.dueAt),
]);

/** A line item on a job — a requirement, a benefit, a responsibility. Ordered,
 *  so it is a row rather than a JSON array the editor has to rewrite whole. */
export const jobItems = pgTable('job_items', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  jobPostingId: integer('job_posting_id'),
  /** 'requirement' | 'responsibility' | 'benefit' | 'nice_to_have'. */
  kind:         varchar('kind', { length: 24 }).notNull(),
  body:         text('body').notNull(),
  position:     integer('position').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_job_items_posting').on(t.jobPostingId, t.kind, t.position),
]);

/** A careers site a tenant publishes its postings to. The connection to the
 *  board itself is a `connections` row; this is the site's own identity. */
export const jobWebsites = pgTable('job_websites', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  slug:        varchar('slug', { length: 120 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  domain:      varchar('domain', { length: 255 }),
  theme:       jsonb('theme'),
  /** 'draft' | 'live' | 'archived'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_job_websites_slug').on(t.tenantId, t.slug),
]);

/** How long a cohort of hires took to reach productivity. A measured number with
 *  a stable definition — kept as its own table rather than a `metric_fact`
 *  because the definition (what "ramped" means for a role) is the data. */
export const rampTimes = pgTable('ramp_times', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  roleFamily:  varchar('role_family', { length: 96 }).notNull(),
  seniority:   varchar('seniority', { length: 32 }),
  definition:  text('definition'),
  targetDays:  integer('target_days'),
  actualDays:  numeric('actual_days', { precision: 6, scale: 1 }),
  sampleSize:  integer('sample_size').notNull().default(0),
  measuredAt:  timestamp('measured_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ramp_times_role').on(t.tenantId, t.roleFamily, t.seniority, t.measuredAt),
]);

/** Retention of a hiring cohort at fixed checkpoints. */
export const cohortRetention = pgTable('cohort_retention', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  cohortKey:    varchar('cohort_key', { length: 64 }).notNull(),
  cohortStartedAt: timestamp('cohort_started_at').notNull(),
  periodDays:   integer('period_days').notNull(),
  startingCount: integer('starting_count').notNull(),
  retainedCount: integer('retained_count').notNull(),
  retentionRate: numeric('retention_rate', { precision: 5, scale: 2 }),
  computedAt:   timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_cohort_retention_point').on(t.tenantId, t.cohortKey, t.periodDays),
]);
