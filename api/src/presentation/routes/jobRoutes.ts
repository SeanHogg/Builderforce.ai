import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Job postings + proposals (the bidding side of the freelance marketplace) and the
 * in-app notification feed.
 *
 *   /api/jobs/*           — employers post work; freelancers browse + bid; employers
 *                           review proposals and accept one → creates an engagement.
 *   /api/notifications/*  — the recipient's in-app feed (both sides).
 *
 * Employer actions use the TENANT JWT; freelancer actions use the WEB JWT.
 *
 * Data access is Drizzle only (`buildDatabase(c.env)`). Selections alias every
 * column back to the snake_case key the raw-SQL rows used, because `mapJob` /
 * `mapProposal` (and therefore the wire shape) are keyed on those names.
 */
import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import {
  freelancerEngagements,
  freelancerNotifications,
  jobInvites,
  jobPostings,
  jobProposals,
  proposalEvaluations,
  savedSearches,
  tasks,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import { masterResumeRevision } from '@builderforce/creation-canvas-contract';
import { extractResumeText } from '../../application/career/resumeExtract';
import { jobDocumentFromText } from '../../application/career/jobDocument';
import { compareResumeToJob, tailorResume } from '../../application/career/jobMatch';
import { readProfileResume, resolvePersonalTenantId } from '../../application/resume/profileResume';
import { ensurePersonalWorkspace } from '../../application/tenant/starterWorkspace';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { admitCandidate } from '../../application/hiring/candidateIntake';
import { parseJsonArray } from '../../domain/shared/json';
import { resolveTenantPlan } from './llmRoutes';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { evaluateProposal, evalPercent, readProposalEvalLens } from '../../application/marketplace/proposalEval';
import { jobFilterConditions, jobFilterIsEmpty, normalizeJobFilters } from '../../application/marketplace/jobFilters';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME,
  BudgetShapeError,
  JOBS_PUBLIC_CACHE_KEY,
  MAX_ATTACHMENTS,
  experienceLevel,
  invalidatePostingCaches,
  normalizeAttachments,
  normalizeBudget,
  normalizeCategory,
  normalizeScreeningAnswers,
  normalizeScreeningQuestions,
  postingTypeIfStated,
  projectLength,
  upsertJobPosting,
  type PostingAttachment,
} from '../../application/marketplace/jobPostings';
import {
  createInvite, hasLiveInvite, markInviteViewed, readInvitesForJob, readInvitesForUser,
  respondToInvite, withdrawInvite,
} from '../../application/marketplace/jobInvites';
import {
  recommendPostingsForFreelancer, recommendTalentForPosting,
} from '../../application/marketplace/talentRecommendations';
import {
  bindScheduleToEngagement, createMilestone, readJobSchedule,
  readProposalSchedule, readProposalSchedules, replaceProposalSchedule,
  type ProposedMilestoneInput,
} from '../../application/marketplace/milestones';
import { hireShape } from '../../application/marketplace/engagementShape';
import { summariseEscrow } from '../../application/marketplace/escrow';
import type { EvalJudge } from '../../application/eval/semanticEval';
import type { Env, HonoEnv } from '../../env';

// `JOBS_PUBLIC_CACHE_KEY`, the posting-type vocabulary and the discipline vocabulary all
// live with the writer now (`application/marketplace/jobPostings.ts` and `jobFilters.ts`).
// They used to be re-declared here AND in `gigMarketplaceRoutes`, which is how the two
// publish paths came to validate `discipline` differently.

function parseSkills(raw: unknown): string[] {
  return parseJsonArray<string>(raw);
}

async function optionalUserId(c: { req: { header(n: string): string | undefined }; env: HonoEnv['Bindings'] }): Promise<string | null> {
  const h = c.req.header('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  try { const p = await verifyWebJwt(h.slice(7), c.env.JWT_SECRET); return p.sub ?? null; } catch { return null; }
}

/** `job_postings.*` — snake_case keys so `mapJob` keeps reading the same row shape. */
const jobColumns = {
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
const proposalColumns = {
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
const clientRatingSql = sql<string | null>`(SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.tenant_id = job_postings.tenant_id AND r.direction = 'freelancer_to_employer')`;
const clientRatingCountSql = sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.tenant_id = job_postings.tenant_id AND r.direction = 'freelancer_to_employer')::int`;

const mapJob = (r: Record<string, unknown>) => ({
  id: r.id,
  tenantId: Number(r.tenant_id),
  tenantName: r.tenant_name ?? null,
  projectId: r.project_id == null ? null : Number(r.project_id),
  title: r.title,
  description: r.description ?? null,
  discipline: r.discipline ?? null,
  skills: parseSkills(r.skills),
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

const mapProposal = (r: Record<string, unknown>) => ({
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

/**
 * The proposed-schedule lines off a bid body, normalised.
 *
 * Validated HERE rather than in the writer because this is the trust boundary: the
 * writer is called with a tenant and a proposal it can rely on, and a bidder's JSON is
 * neither. Silently drops unusable lines rather than 400-ing the whole bid — a
 * malformed extra row must not lose somebody the proposal they wrote.
 */
const proposedMilestones = (raw: unknown): ProposedMilestoneInput[] => {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const line = entry as Record<string, unknown>;
    const title = typeof line.title === 'string' ? line.title.trim().slice(0, 200) : '';
    if (!title) return [];
    const amountCents = Math.floor(Number(line.amountCents ?? 0));
    const dueAt = typeof line.dueAt === 'string' && line.dueAt ? new Date(line.dueAt) : null;
    return [{
      title,
      description: typeof line.description === 'string' ? line.description.slice(0, 2000) : null,
      amountCents: Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 0,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
    }];
  });
};

/**
 * What each invite failure says to the person who caused it.
 *
 * The application service returns CODES, not sentences: it has no opinion about HTTP and
 * no business holding user-facing prose. The route owns the wording, one table, so a
 * status and a message can never be chosen independently at four call sites.
 */
const INVITE_MESSAGES: Record<'job_not_found' | 'job_not_open' | 'person_not_found' | 'self_invite', string> = {
  job_not_found: 'Not found',
  job_not_open: 'This posting is no longer open, so nobody can be invited to bid on it',
  person_not_found: 'That account no longer exists',
  self_invite: 'You cannot invite yourself to your own posting',
};

const INVITE_RESPONSE_MESSAGES: Record<'not_found' | 'expired' | 'already_answered' | 'job_closed', string> = {
  not_found: 'Not found',
  expired: 'This invitation has expired',
  already_answered: 'You have already answered this invitation',
  job_closed: 'This job is no longer open',
};

/** Upload ceiling for a job description, matching the résumé upload. */
const JOB_EXTRACT_MAX_BYTES = 10 * 1024 * 1024;

/** A job alert on the wire. `enabled` lives inside `filters` so turning one off does
 *  not need a column the other four saved-search scopes would carry unused. */
function mapAlert(row: { id: number; name: string; filters: unknown; last_run_at: Date | null; result_count: number | null }) {
  const filters = (row.filters ?? {}) as Record<string, unknown>;
  const { enabled, ...criteria } = filters;
  return {
    id: String(row.id),
    name: row.name,
    filters: criteria,
    enabled: enabled !== false,
    lastRunAt: row.last_run_at ?? null,
    resultCount: row.result_count ?? null,
  };
}

/**
 * The workspace a job seeker's own records live in, provisioning it if missing.
 *
 * A saved search is tenant-scoped and a for-hire account is not a member of any
 * employer's workspace, so their alerts belong to the personal workspace 0471 gives
 * them. Self-heals accounts created before that existed.
 */
async function seekerTenantId(db: Db, env: Env, userId: string): Promise<number | null> {
  const existing = await resolvePersonalTenantId(db, userId);
  if (existing !== null) return existing;
  const [user] = await db.select({ email: users.email, displayName: users.displayName })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  await ensurePersonalWorkspace(env, db, {
    id: userId, email: user.email, displayName: user.displayName, accountType: 'freelancer',
  });
  return resolvePersonalTenantId(db, userId);
}


// ---------------------------------------------------------------------------
// Attachments (0985) — the EXISTING bucket, not a new blob store
// ---------------------------------------------------------------------------
//
// `env.UPLOADS` is the same R2 bucket `POST /api/freelancers/me/resume` and
// `/me/avatar` already put into, and the shape here is theirs: a prefixed key, an
// `httpMetadata.contentType`, and a row that holds METADATA pointing at the bytes.
// Nothing about a job brief justifies a second storage mechanism, and a second one is
// how a deployment ends up with files it cannot enumerate.
//
// The key prefix encodes ownership (`job-attachments/<tenant>/<job>/…`,
// `proposal-attachments/<job>/<proposal>/…`) but the ACCESS CHECK is never the key: an
// attachment is served only after its id has been found on a row the caller is entitled
// to read. A key is a name, not a credential.

/** Read one uploaded file off a multipart body, validated. */
async function readUpload(c: { req: { formData(): Promise<FormData> } }): Promise<
  { ok: true; file: File } | { ok: false; error: string; status: 400 | 413 | 415 }
> {
  const form = await c.req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') return { ok: false, error: 'file is required', status: 400 };
  const file = entry as unknown as File;
  if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: 'File too large (max 10MB)', status: 413 };
  const type = file.type || 'application/octet-stream';
  if (!ATTACHMENT_MIME.has(type)) return { ok: false, error: `File type ${type} is not allowed`, status: 415 };
  return { ok: true, file };
}

/** Put the bytes and describe them. The caller owns where the description is stored. */
async function putAttachment(env: Env, prefix: string, file: File): Promise<PostingAttachment | null> {
  if (!env.UPLOADS) return null;
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const id = crypto.randomUUID();
  const key = `${prefix}/${id}.${ext}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return { id, key, name: file.name.slice(0, 200), mime: file.type || null, size: file.size };
}

/** Stream one already-authorised attachment out of R2. */
async function serveAttachment(env: Env, attachments: PostingAttachment[], attachmentId: string): Promise<Response> {
  const found = attachments.find((a) => a.id === attachmentId);
  if (!found) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  if (!env.UPLOADS) return new Response(JSON.stringify({ error: 'File storage is not configured' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const obj = await env.UPLOADS.get(found.key);
  if (!obj) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const headers = new Headers();
  headers.set('Content-Type', found.mime ?? obj.httpMetadata?.contentType ?? 'application/octet-stream');
  // An attachment is somebody's brief or work sample: shown in the app, never cached by
  // a shared proxy.
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('Content-Disposition', `inline; filename="${found.name.replace(/[^\w.\- ]/g, '_')}"`);
  return new Response(obj.body, { headers });
}

export function createJobRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ---- Job seeker: saved jobs -------------------------------------------------
  //
  // A saved job is a proposal in the `saved` state, NOT a second table. hired.video
  // modelled bookmarks separately, which then needed its own join to answer "did I
  // already apply to this?" and could disagree with the answer the proposals table
  // gave. Saving and applying are two points on one lifecycle — save → submitted →
  // shortlisted → accepted — so they are one row whose status moves, which is the
  // register's rule that a new KIND is a column value rather than a new table.

  // GET /saved — the seeker's shortlist.
  router.get('/saved', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const rows = await db
      .select({ ...proposalColumns, job_title: jobPostings.title })
      .from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(and(
        eq(jobProposals.freelancerUserId, c.get('userId') as string),
        eq(jobProposals.status, 'saved'),
      ))
      .orderBy(desc(jobProposals.createdAt))
      .limit(200);
    return c.json(rows.map(mapProposal));
  });

  // POST /:id/save — bookmark a job. Never downgrades a real bid back to `saved`:
  // saving something you already applied to is a no-op, not a withdrawal.
  router.post('/:id/save', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    // The marketplace is the cross-tenant surface: a freelancer has no tenant of
    // their own, so bookmarking an employer's posting reads past the tenant filter
    // by design. Declared rather than baselined, and the id is the access predicate.
    const [job] = await db
      .select({ id: jobPostings.id })
      .from(jobPostings)
      .where(acrossTenants(jobPostings, 'public_catalogue', eq(jobPostings.id, id)));
    if (!job) return c.json({ error: 'Not found' }, 404);
    const pid = crypto.randomUUID();
    await db.insert(jobProposals)
      .values({ id: pid, jobId: id, freelancerUserId: userId, status: 'saved' })
      .onConflictDoUpdate({
        target: [jobProposals.jobId, jobProposals.freelancerUserId],
        set: { updatedAt: sql`NOW()` },
      });
    return c.json({ ok: true });
  });

  // DELETE /:id/save — unsave. Only ever removes a `saved` row, so this can never
  // silently delete a submitted bid.
  router.delete('/:id/save', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    await db.delete(jobProposals).where(and(
      eq(jobProposals.jobId, c.req.param('id')),
      eq(jobProposals.freelancerUserId, c.get('userId') as string),
      eq(jobProposals.status, 'saved'),
    ));
    return c.json({ ok: true });
  });

  // ---- Job seeker: invites addressed to me, and what to bid on ----------------
  //
  // Registered before `/:id` so a literal first segment is never swallowed by the
  // posting-detail route.

  // GET /invites/mine — the invitee's side of the marketplace. Without this the invite
  // is a notification nobody can act on, which is the thing it exists not to be.
  router.get('/invites/mine', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const invites = await readInvitesForUser(db, c.get('userId') as string, {
      liveOnly: c.req.query('live') === '1',
    });
    return c.json(invites);
  });

  // POST /invites/:inviteId/viewed — the invitee opened it. `sent` -> `viewed` only, so
  // this can never move an answered or lapsed invite.
  router.post('/invites/:inviteId/viewed', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    await markInviteViewed(db, c.get('userId') as string, c.req.param('inviteId'));
    return c.json({ ok: true });
  });

  // POST /invites/:inviteId/respond { accept } — accepting OPENS THE PROPOSAL.
  //
  // The returned `proposalId` is the whole point: the client navigates straight into the
  // bid form on a row that already exists, rather than being told "you have been invited"
  // and left to find the posting again.
  router.post('/invites/:inviteId/respond', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const b = await c.req.json<{ accept?: boolean }>().catch((): { accept?: boolean } => ({}));
    const result = await respondToInvite(db, c.env as Env, {
      userId: c.get('userId') as string,
      inviteId: c.req.param('inviteId'),
      accept: b.accept === true,
    });
    if ('error' in result) {
      const status = result.error === 'not_found' ? 404 : 409;
      return c.json({ error: INVITE_RESPONSE_MESSAGES[result.error], code: result.error }, status);
    }
    return c.json(result);
  });

  // GET /recommended — the cached match query, seeker direction. Postings ranked for the
  // signed-in freelancer's own profile; empty (honestly) when they have no profile to
  // match on.
  router.get('/recommended', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    return c.json(await recommendPostingsForFreelancer(db, c.env as Env, { userId: c.get('userId') as string }));
  });

  // ---- Job seeker: job alerts -------------------------------------------------
  //
  // An alert is a SAVED SEARCH with `scope='listing'`, not a new table: it is the same
  // {name, filters, owner, last run} shape `saved_searches` already holds for contacts,
  // companies, deals and candidates, and that table's `scope` column exists precisely
  // so the fifth one does not add DDL.

  router.get('/alerts', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = await seekerTenantId(db, c.env as Env, c.get('userId') as string);
    if (tenantId === null) return c.json([]);
    const rows = await db.select({
      id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
      last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount,
    }).from(savedSearches)
      .where(and(
        eq(savedSearches.tenantId, tenantId),
        eq(savedSearches.ownerRef, c.get('userId') as string),
        eq(savedSearches.scope, 'listing'),
      ))
      .orderBy(desc(savedSearches.createdAt))
      .limit(50);
    return c.json(rows.map(mapAlert));
  });

  router.post('/alerts', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ name?: string; filters?: Record<string, unknown>; enabled?: boolean }>();
    const name = String(body.name ?? '').trim().slice(0, 200);
    if (!name) return c.json({ error: 'name is required' }, 400);
    const tenantId = await seekerTenantId(db, c.env as Env, userId);
    if (tenantId === null) return c.json({ error: 'Alerts unavailable' }, 503);
    const [row] = await db.insert(savedSearches)
      .values({
        tenantId, ownerRef: userId, scope: 'listing', name,
        filters: { ...(body.filters ?? {}), enabled: body.enabled !== false },
      })
      .onConflictDoUpdate({
        target: [savedSearches.tenantId, savedSearches.ownerRef, savedSearches.scope, savedSearches.name],
        set: { filters: sql`excluded.filters`, updatedAt: sql`NOW()` },
      })
      .returning({ id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
        last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount });
    return c.json(mapAlert(row!), 201);
  });

  // PATCH /alerts/:id — rename, re-filter, or turn it on and off. One route rather
  // than a separate /toggle, because "enabled" is a field like any other.
  router.patch('/alerts/:id', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ name?: string; filters?: Record<string, unknown>; enabled?: boolean }>();
    const tenantId = await seekerTenantId(db, c.env as Env, userId);
    if (tenantId === null) return c.json({ error: 'Not found' }, 404);
    const [existing] = await db.select({ filters: savedSearches.filters })
      .from(savedSearches)
      .where(and(
        eq(savedSearches.id, Number(c.req.param('id'))),
        eq(savedSearches.tenantId, tenantId),
        eq(savedSearches.ownerRef, userId),
        eq(savedSearches.scope, 'listing'),
      ));
    if (!existing) return c.json({ error: 'Not found' }, 404);
    const current = (existing.filters ?? {}) as Record<string, unknown>;
    const filters = {
      ...current,
      ...(body.filters ?? {}),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    };
    const [row] = await db.update(savedSearches)
      .set({ ...(body.name ? { name: body.name.slice(0, 200) } : {}), filters, updatedAt: sql`NOW()` })
      .where(and(
        eq(savedSearches.id, Number(c.req.param('id'))),
        eq(savedSearches.tenantId, tenantId),
        eq(savedSearches.ownerRef, userId),
      ))
      .returning({ id: savedSearches.id, name: savedSearches.name, filters: savedSearches.filters,
        last_run_at: savedSearches.lastRunAt, result_count: savedSearches.resultCount });
    return row ? c.json(mapAlert(row)) : c.json({ error: 'Not found' }, 404);
  });

  router.delete('/alerts/:id', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const tenantId = await seekerTenantId(db, c.env as Env, userId);
    if (tenantId === null) return c.json({ ok: true });
    await db.delete(savedSearches).where(and(
      eq(savedSearches.id, Number(c.req.param('id'))),
      eq(savedSearches.tenantId, tenantId),
      eq(savedSearches.ownerRef, userId),
      eq(savedSearches.scope, 'listing'),
    ));
    return c.json({ ok: true });
  });

  // POST /extract — read a job description out of a pasted body OR an uploaded file,
  // and (when the caller has a résumé) score it against theirs in the same call.
  //
  // Deterministic: the same server-side extractor the résumé upload uses reads the
  // file, and the same `career/` comparison the Recruiter agent uses does the scoring.
  // No model, no tenant plan, no provider outage — which is what makes this usable by
  // a job seeker looking at a posting on their phone.
  router.post('/extract', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const contentType = c.req.header('content-type') ?? '';

    let text = '';
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const entry = form.get('file');
      if (!entry || typeof entry === 'string') return c.json({ error: 'file is required' }, 400);
      const file = entry as unknown as File;
      if (file.size > JOB_EXTRACT_MAX_BYTES) return c.json({ error: 'File too large (max 10MB)' }, 413);
      const extracted = await extractResumeText(new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type, filename: file.name,
      });
      if (!extracted.ok) return c.json({ error: extracted.message, code: extracted.code }, 422);
      text = extracted.text;
    } else {
      const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
      text = String(body.text ?? '').slice(0, 200_000);
    }
    if (text.trim().length < 40) return c.json({ error: 'That job description is too short to read' }, 400);

    const job = jobDocumentFromText(text);
    // The comparison is the reason a seeker extracts a JD at all, so it rides along
    // rather than forcing a second round trip.
    const resume = await readProfileResume(db, userId);
    const resumeText = resume ? masterResumeRevision(resume.family).markdown : '';
    return c.json({
      job,
      match: resumeText ? compareResumeToJob(resumeText, job.text) : null,
      tailor: resumeText ? tailorResume(resumeText, job.text) : null,
    });
  });

  // ---- Freelancer: my proposals (registered before /:id so it isn't swallowed) ----
  router.get('/proposals/mine', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const rows = await db
      .select({ ...proposalColumns, job_title: jobPostings.title })
      .from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(eq(jobProposals.freelancerUserId, userId))
      .orderBy(desc(jobProposals.createdAt))
      .limit(200);
    return c.json(rows.map(mapProposal));
  });

  // POST /proposals/:pid/attachments — the BIDDER attaches a work sample to their own
  // proposal (multipart `file`). Scoped to their proposal, so this can never write onto
  // somebody else's bid.
  router.post('/proposals/:pid/attachments', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const [proposal] = await db
      .select({ id: jobProposals.id, jobId: jobProposals.jobId, attachments: jobProposals.attachments })
      .from(jobProposals)
      .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)))
      .limit(1);
    if (!proposal) return c.json({ error: 'Not found' }, 404);
    const existing = normalizeAttachments(proposal.attachments);
    if (existing.length >= MAX_ATTACHMENTS) return c.json({ error: `A proposal may carry at most ${MAX_ATTACHMENTS} attachments` }, 409);
    const upload = await readUpload(c);
    if (!upload.ok) return c.json({ error: upload.error }, upload.status);
    const attachment = await putAttachment(c.env as Env, `proposal-attachments/${proposal.jobId}/${pid}`, upload.file);
    if (!attachment) return c.json({ error: 'File storage is not configured on this deployment.' }, 503);
    const attachments = [...existing, attachment];
    await db.update(jobProposals)
      .set({ attachments, updatedAt: sql`NOW()` })
      .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)));
    return c.json({ attachment, attachments }, 201);
  });

  // GET /proposals/:pid/attachments/:attachmentId — the BIDDER reads back their own.
  // The employer's copy of this read hangs off the posting (`/:id/proposals/:pid/…`), so
  // each side has exactly one auth rather than one route trying to satisfy two.
  router.get('/proposals/:pid/attachments/:attachmentId', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const [row] = await db
      .select({ attachments: jobProposals.attachments })
      .from(jobProposals)
      .where(and(
        eq(jobProposals.id, c.req.param('pid')),
        eq(jobProposals.freelancerUserId, c.get('userId') as string),
      ))
      .limit(1);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return serveAttachment(c.env as Env, normalizeAttachments(row.attachments), c.req.param('attachmentId'));
  });

  // DELETE /proposals/:pid/attachments/:attachmentId — the bidder removes their own.
  router.delete('/proposals/:pid/attachments/:attachmentId', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const [row] = await db
      .select({ attachments: jobProposals.attachments })
      .from(jobProposals)
      .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)))
      .limit(1);
    if (!row) return c.json({ error: 'Not found' }, 404);
    const existing = normalizeAttachments(row.attachments);
    const target = existing.find((a) => a.id === c.req.param('attachmentId'));
    if (!target) return c.json({ error: 'Not found' }, 404);
    const attachments = existing.filter((a) => a.id !== target.id);
    await db.update(jobProposals)
      .set({ attachments, updatedAt: sql`NOW()` })
      .where(and(eq(jobProposals.id, pid), eq(jobProposals.freelancerUserId, userId)));
    if (c.env.UPLOADS) {
      await c.env.UPLOADS.delete(target.key).catch((error) => {
        reportCaughtError(error, { source: 'presentation/routes/jobRoutes.ts', operation: 'deleteProposalAttachment', level: 'warning', context: { key: target.key } });
      });
    }
    return c.json({ ok: true, attachments });
  });

  // POST /proposals/:pid/withdraw — freelancer withdraws their bid.
  router.post('/proposals/:pid/withdraw', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const rows = await db
      .update(jobProposals)
      .set({ status: 'withdrawn', updatedAt: sql`NOW()` })
      .where(and(
        eq(jobProposals.id, pid),
        eq(jobProposals.freelancerUserId, userId),
        inArray(jobProposals.status, ['submitted', 'shortlisted']),
      ))
      .returning({ id: jobProposals.id });
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // ---- Employer: the job's payment schedule ------------------------------------
  //
  // A fixed-price posting says what it will pay FOR, before anybody bids. These
  // milestones hang off the job (`job_id`), and accepting a proposal stamps them onto
  // the engagement — see `bindScheduleToEngagement` in the accept route below. That is
  // why the schedule is authored here rather than only after hiring: a freelancer
  // deciding whether to bid needs to see the deliverables and the money attached to
  // them, and a schedule invented after the handshake is a different agreement.
  //
  // The escrow ACTIONS are deliberately not here. Nothing on a job-level milestone can
  // be funded, submitted or released — it has no engagement and therefore no
  // counterparty — so the whole state machine lives on the engagement routes and this
  // surface only authors drafts.

  // GET /:id/milestones — the schedule attached to one of this tenant's postings.
  router.get('/:id/milestones', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const milestones = await readJobSchedule(db, c.get('tenantId') as number, c.req.param('id'));
    return c.json({ milestones, summary: summariseEscrow(milestones) });
  });

  // POST /:id/milestones — add a deliverable to a posting. Always a draft.
  router.post('/:id/milestones', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const jobId = c.req.param('id');
    const b = await c.req.json<{ title?: string; description?: string; amountCents?: number; currency?: string; sequence?: number; dueAt?: string }>();
    const title = String(b.title ?? '').trim();
    if (!title) return c.json({ error: 'title is required' }, 400);
    const amountCents = Math.floor(Number(b.amountCents ?? 0));
    if (!Number.isFinite(amountCents) || amountCents < 0) return c.json({ error: 'amountCents must be a positive integer' }, 400);
    // The posting must be this tenant's, and must still be open: adding deliverables to
    // a filled job would change the agreement after somebody was hired against it.
    const [job] = await db.select({ id: jobPostings.id })
      .from(jobPostings)
      .where(and(eq(jobPostings.id, jobId), eq(jobPostings.tenantId, tenantId), eq(jobPostings.status, 'open')))
      .limit(1);
    if (!job) return c.json({ error: 'Not found' }, 404);
    const milestone = await createMilestone(db, {
      tenantId,
      jobId,
      title,
      description: b.description ?? null,
      amountCents,
      currency: b.currency,
      sequence: Number.isFinite(Number(b.sequence)) ? Number(b.sequence) : 0,
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
      createdByUserId: c.get('userId') as string,
    });
    return c.json({ milestone }, 201);
  });

  // POST /proposals/:pid/accept — EMPLOYER accepts a proposal → creates an active
  // engagement, marks the job filled, and notifies the freelancer.
  router.post('/proposals/:pid/accept', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const pid = c.req.param('pid');
    const accepted = await db.transaction(async (tx) => {
      const [pr] = await tx.select({
        ...proposalColumns,
        job_tenant: jobPostings.tenantId,
        project_id: jobPostings.projectId,
        job_title: jobPostings.title,
        job_engagement_type: jobPostings.engagementType,
        source_ticket_id: jobPostings.sourceTicketId,
      }).from(jobProposals)
        .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
        .where(and(eq(jobProposals.id, pid), inArray(jobProposals.status, ['submitted', 'shortlisted'])));
      if (!pr || Number(pr.job_tenant) !== Number(tenantId)) return null;

      // This conditional transition is the concurrency gate. Only one request can
      // move an open posting to filled; a replay cannot mint another engagement.
      const claimed = await tx.update(jobPostings)
        .set({ status: 'filled', closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jobPostings.id, pr.job_id), eq(jobPostings.tenantId, tenantId), eq(jobPostings.status, 'open')))
        .returning({ id: jobPostings.id });
      if (claimed.length === 0) return { conflict: true as const };

      const projectId = pr.project_id == null ? null : Number(pr.project_id);
      const [existing] = await tx.select({ id: freelancerEngagements.id })
        .from(freelancerEngagements)
        .where(and(
          eq(freelancerEngagements.tenantId, tenantId),
          eq(freelancerEngagements.freelancerUserId, pr.freelancer_user_id),
          sql`COALESCE(${freelancerEngagements.projectId}, 0) = COALESCE(${projectId}, 0)`,
          isNull(freelancerEngagements.terminatedAt),
        ));
      const engagementId = existing?.id ?? crypto.randomUUID();
      if (existing) {
        await tx.update(freelancerEngagements)
          .set({ status: 'active', hiredAt: sql`COALESCE(${freelancerEngagements.hiredAt}, NOW())`, rateCents: pr.rate_cents, updatedAt: new Date() })
          .where(eq(freelancerEngagements.id, engagementId));
      } else {
        await tx.insert(freelancerEngagements).values({
          id: engagementId, tenantId, projectId,
          freelancerUserId: pr.freelancer_user_id, status: 'active',
          rateCents: pr.rate_cents, currency: pr.currency ?? 'USD',
          title: pr.job_title, createdByUserId: actor, hiredAt: new Date(),
          // Frozen at hire from the posting that was bid on — see 0928 on why this is
          // a declared copy rather than a join, and why it must not be re-read later.
          engagementType: hireShape(pr.job_engagement_type),
        });
      }
      // Carry the AGREED payment schedule onto the engagement, in the SAME transaction
      // that created it. Naming the accepted proposal is what makes this the agreed one:
      // a bid that counter-proposed its own deliverables binds THOSE, and the posting's
      // published schedule binds only when the accepted bid proposed none. Accepting a
      // proposal is agreeing to that proposal — funding the posting's terms over the top
      // would discard the counter-offer at the moment it was accepted. A no-op for an
      // hourly posting, which simply has no schedule at all.
      await bindScheduleToEngagement(tx, {
        tenantId,
        jobId: pr.job_id as string,
        engagementId,
        freelancerUserId: pr.freelancer_user_id as string,
        proposalId: pid,
      });
      await tx.update(jobProposals).set({ status: 'accepted', updatedAt: new Date() }).where(eq(jobProposals.id, pid));
      await tx.update(jobProposals).set({ status: 'declined', updatedAt: new Date() })
        .where(and(eq(jobProposals.jobId, pr.job_id), inArray(jobProposals.status, ['submitted', 'shortlisted'])));
      return { conflict: false as const, engagementId, proposal: pr };
    });
    if (!accepted) return c.json({ error: 'Not found' }, 404);
    if (accepted.conflict) return c.json({ error: 'This job has already been filled' }, 409);
    await invalidatePostingCaches(c.env as Env, tenantId, accepted.proposal.source_ticket_id as number | null);
    const [ten] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    await notify(db, c.env, { userId: accepted.proposal.freelancer_user_id, tenantId, kind: 'hired', title: `${ten?.name ?? 'A workspace'} accepted your proposal for "${accepted.proposal.job_title}"`, ref: accepted.engagementId });
    return c.json({ ok: true, engagementId: accepted.engagementId });
  });

  // POST /proposals/:pid/decline — EMPLOYER declines a proposal, with an optional
  // courteous "not selected this time" message surfaced to the candidate.
  router.post('/proposals/:pid/decline', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const pid = c.req.param('pid');
    const b = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.slice(0, 2000) : null;
    const rows = await db
      .update(jobProposals)
      .set({ status: 'declined', declineReason: reason, updatedAt: sql`NOW()` })
      .from(jobPostings)
      .where(and(
        eq(jobProposals.jobId, jobPostings.id),
        eq(jobProposals.id, pid),
        eq(jobPostings.tenantId, tenantId),
        inArray(jobProposals.status, ['submitted', 'shortlisted']),
      ))
      .returning({ freelancer_user_id: jobProposals.freelancerUserId, job_id: jobProposals.jobId });
    const declined = rows[0];
    if (!declined) return c.json({ error: 'Not found' }, 404);
    await notify(db, c.env, { userId: declined.freelancer_user_id, tenantId, kind: 'declined', title: 'A proposal was declined', body: reason, ref: declined.job_id });
    return c.json({ ok: true });
  });

  // POST /proposals/:pid/shortlist — EMPLOYER shortlists a candidate's bid.
  router.post('/proposals/:pid/shortlist', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const pid = c.req.param('pid');
    const rows = await db
      .update(jobProposals)
      .set({ status: 'shortlisted', updatedAt: sql`NOW()` })
      .from(jobPostings)
      .where(and(
        eq(jobProposals.jobId, jobPostings.id),
        eq(jobProposals.id, pid),
        eq(jobPostings.tenantId, tenantId),
        inArray(jobProposals.status, ['submitted', 'shortlisted']),
      ))
      .returning({ freelancer_user_id: jobProposals.freelancerUserId, job_id: jobProposals.jobId, job_title: jobPostings.title });
    const pr = rows[0];
    if (!pr) return c.json({ error: 'Not found' }, 404);
    await notify(db, c.env, { userId: pr.freelancer_user_id, tenantId, kind: 'shortlisted', title: `You were shortlisted for "${pr.job_title}"`, ref: pr.job_id });
    return c.json({ ok: true });
  });

  // POST /proposals/:pid/evaluate — EMPLOYER AI-scores a bid against the posting's
  // requirements (LLM-as-judge via the metered gateway; lexical fallback). One row
  // per eval run in proposal_evaluations; the 0..100 overall is cached on the proposal.
  router.post('/proposals/:pid/evaluate', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const pid = c.req.param('pid');
    const [pr] = await db
      .select({
        id: jobProposals.id,
        cover_note: jobProposals.coverNote,
        job_id: jobProposals.jobId,
        job_tenant: jobPostings.tenantId,
        job_title: jobPostings.title,
        description: jobPostings.description,
        requirements: jobPostings.requirements,
      })
      .from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(eq(jobProposals.id, pid));
    if (!pr || Number(pr.job_tenant) !== Number(tenantId)) return c.json({ error: 'Not found' }, 404);
    const requirements = pr.requirements || pr.description || '';
    const proposal = pr.cover_note || '';
    let judge: EvalJudge | undefined;
    const plan = await resolveTenantPlan(c.env as Env, tenantId).catch(() => null);
    if (plan) judge = gatewayJudge(c.env as Env, plan.effectivePlan, plan.premiumOverride);
    const scores = await evaluateProposal({ requirements, scope: pr.description ?? undefined, proposal }, { judge });
    const overall100 = evalPercent(scores.overall);
    await db.insert(proposalEvaluations).values({
      id: crypto.randomUUID(),
      tenantId,
      subjectType: 'job_proposal',
      subjectId: pid,
      jobId: pr.job_id,
      faithfulness: scores.faithfulness,
      answerRelevance: scores.answerRelevance,
      contextRelevance: scores.contextRelevance,
      hallucinationRate: scores.hallucinationRate,
      overall: scores.overall,
      method: scores.method,
      summary: null,
      evaluatedByUserId: actor,
    });
    await db.update(jobProposals).set({ lastEvalOverall: overall100, updatedAt: sql`NOW()` }).where(eq(jobProposals.id, pid));
    return c.json({ ...scores, overall100 });
  });

  // ---- Employer: invites, recommendations, the eval lens, attachments ---------

  // GET /:id/invites — who this posting has invited, and what they said.
  router.get('/:id/invites', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    return c.json(await readInvitesForJob(db, c.get('tenantId') as number, c.req.param('id')));
  });

  // POST /:id/invites — invite ONE named freelancer. Idempotent per (posting, person).
  router.post('/:id/invites', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const b = await c.req.json<{ freelancerUserId?: string; message?: string; expiresInDays?: number }>()
      .catch((): { freelancerUserId?: string; message?: string; expiresInDays?: number } => ({}));
    const freelancerUserId = String(b.freelancerUserId ?? '').trim();
    if (!freelancerUserId) return c.json({ error: 'freelancerUserId is required' }, 400);
    const result = await createInvite(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      jobId: c.req.param('id'),
      freelancerUserId,
      invitedByUserId: c.get('userId') as string,
      message: b.message,
      expiresInDays: b.expiresInDays,
    });
    if ('error' in result) {
      const status = result.error === 'job_not_found' || result.error === 'person_not_found' ? 404 : 409;
      return c.json({ error: INVITE_MESSAGES[result.error], code: result.error }, status);
    }
    return c.json(result.invite, 201);
  });

  // DELETE /:id/invites/:inviteId — withdraw an UNANSWERED invite. An answered one is
  // left alone: deleting somebody's "no" is rewriting the record of the exchange.
  router.delete('/:id/invites/:inviteId', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const removed = await withdrawInvite(db, c.get('tenantId') as number, c.req.param('inviteId'));
    return removed ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  // GET /:id/recommendations — the cached match query, client direction: who should be
  // invited to bid on this posting. People who have already bid are excluded — their
  // proposal is in the next tab.
  router.get('/:id/recommendations', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const matches = await recommendTalentForPosting(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      jobId: c.req.param('id'),
    });
    return matches === null ? c.json({ error: 'Not found' }, 404) : c.json(matches);
  });

  // GET /:id/evaluations — the INSIGHTS lens over this posting's AI evaluations:
  // distribution, the lexical-vs-LLM split, and the drift between each proposal's cached
  // headline and its newest evaluation. See `proposalEval.ts` for why the third one is
  // the reading that decides whether the first two mean anything.
  router.get('/:id/evaluations', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const lens = await readProposalEvalLens(db, { tenantId: c.get('tenantId') as number, jobId: c.req.param('id') });
    return lens === null ? c.json({ error: 'Not found' }, 404) : c.json(lens);
  });

  // POST /:id/attachments — attach a brief to a posting (multipart `file`).
  router.post('/:id/attachments', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [job] = await db
      .select({ id: jobPostings.id, attachments: jobPostings.attachments, source_ticket_id: jobPostings.sourceTicketId })
      .from(jobPostings)
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)))
      .limit(1);
    if (!job) return c.json({ error: 'Not found' }, 404);
    const existing = normalizeAttachments(job.attachments);
    if (existing.length >= MAX_ATTACHMENTS) return c.json({ error: `A posting may carry at most ${MAX_ATTACHMENTS} attachments` }, 409);
    const upload = await readUpload(c);
    if (!upload.ok) return c.json({ error: upload.error }, upload.status);
    const attachment = await putAttachment(c.env as Env, `job-attachments/${tenantId}/${id}`, upload.file);
    if (!attachment) return c.json({ error: 'File storage is not configured on this deployment.' }, 503);
    const attachments = [...existing, attachment];
    await db.update(jobPostings)
      .set({ attachments, updatedAt: sql`NOW()` })
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)));
    await invalidatePostingCaches(c.env as Env, tenantId, job.source_ticket_id);
    return c.json({ attachment, attachments }, 201);
  });

  // DELETE /:id/attachments/:attachmentId — detach. The R2 object goes too: an orphaned
  // blob nothing references is a file we cannot answer a deletion request about.
  router.delete('/:id/attachments/:attachmentId', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [job] = await db
      .select({ attachments: jobPostings.attachments, source_ticket_id: jobPostings.sourceTicketId })
      .from(jobPostings)
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)))
      .limit(1);
    if (!job) return c.json({ error: 'Not found' }, 404);
    const existing = normalizeAttachments(job.attachments);
    const target = existing.find((a) => a.id === c.req.param('attachmentId'));
    if (!target) return c.json({ error: 'Not found' }, 404);
    const attachments = existing.filter((a) => a.id !== target.id);
    await db.update(jobPostings)
      .set({ attachments, updatedAt: sql`NOW()` })
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)));
    if (c.env.UPLOADS) {
      await c.env.UPLOADS.delete(target.key).catch((error) => {
        // The row is already detached, so the file is unreachable either way; a failed
        // blob delete is a cleanup problem, not a failed request. Logged, never silent.
        reportCaughtError(error, { source: 'presentation/routes/jobRoutes.ts', operation: 'deleteJobAttachment', level: 'warning', context: { key: target.key } });
      });
    }
    await invalidatePostingCaches(c.env as Env, tenantId, job.source_ticket_id);
    return c.json({ ok: true, attachments });
  });

  // GET /:id/proposals/:pid/attachments/:attachmentId — the EMPLOYER reads a bidder's
  // work sample. Two ownership hops in one predicate: the posting must be this tenant's
  // and the proposal must be on that posting.
  router.get('/:id/proposals/:pid/attachments/:attachmentId', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const [row] = await db
      .select({ attachments: jobProposals.attachments })
      .from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(and(
        eq(jobProposals.id, c.req.param('pid')),
        eq(jobProposals.jobId, c.req.param('id')),
        eq(jobPostings.tenantId, c.get('tenantId') as number),
      ))
      .limit(1);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return serveAttachment(c.env as Env, normalizeAttachments(row.attachments), c.req.param('attachmentId'));
  });

  // ---- Employer: my jobs ----
  router.get('/mine', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        ...jobColumns,
        // `job_postings.id` spelled out, not interpolated: this statement has no
        // join, so drizzle would emit a bare `"id"` that the subquery resolves
        // against its own `job_proposals p` scope — always-0 counts.
        proposal_count: sql<number>`(SELECT COUNT(*) FROM job_proposals p WHERE p.job_id = job_postings.id AND p.status NOT IN ('withdrawn'))::int`,
      })
      .from(jobPostings)
      .where(eq(jobPostings.tenantId, tenantId))
      .orderBy(desc(jobPostings.createdAt))
      .limit(200);
    return c.json(rows.map(mapJob));
  });

  // GET /:id/proposals — EMPLOYER views proposals on their job.
  router.get('/:id/proposals', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [job] = await db
      .select({ id: jobPostings.id })
      .from(jobPostings)
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)));
    if (!job) return c.json({ error: 'Not found' }, 404);
    // Both reads together, and the schedules in ONE query grouped by proposal rather
    // than one read per bid — an employer comparing ten offers must not cost ten
    // round-trips. Deliberately uncached: a counter-offer the bidder revised a second
    // ago must not be the one the employer accepts.
    const [rows, schedules] = await Promise.all([
      db.select({ ...proposalColumns, freelancer_name: users.displayName })
        .from(jobProposals)
        .innerJoin(users, eq(users.id, jobProposals.freelancerUserId))
        .where(eq(jobProposals.jobId, id))
        .orderBy(desc(jobProposals.createdAt)),
      readProposalSchedules(db, tenantId, id),
    ]);
    return c.json(rows.map((row) => mapProposal({ ...row, milestones: schedules[String(row.id)] ?? [] })));
  });

  // POST / — EMPLOYER posts a job.
  //
  // The SECOND door onto `upsertJobPosting`; `POST /api/marketplace/publish` is the
  // first. Everything that decides what a posting IS — its identity when it names a
  // ticket, its category, its money, its shape, the caches it dirties — is in the
  // service, so a posting created either way is the same row. Before that, a `POST
  // /api/jobs` carrying a `sourceTicketId` minted a duplicate posting for a ticket that
  // already had one, and stamped the ticket's back-ref onto whichever landed last.
  router.post('/', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    try {
      const result = await upsertJobPosting(db, c.env as Env, {
        tenantId: c.get('tenantId') as number,
        actorUserId: c.get('userId') as string,
        draft: b,
      });
      return c.json({ id: result.id, reused: result.reused }, result.reused ? 200 : 201);
    } catch (error) {
      if (error instanceof BudgetShapeError) return c.json({ error: error.message }, 400);
      if (error instanceof Error && error.message === 'title required') return c.json({ error: 'title required' }, 400);
      throw error;
    }
  });

  // PATCH /:id — EMPLOYER edits or closes a job.
  router.patch('/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<Record<string, unknown>>();
    const status = ['open', 'closed', 'filled'].includes(String(b.status ?? '')) ? String(b.status) : null;
    const postingType = postingTypeIfStated(b.postingType);
    const engagementType = hireShape(b.engagementType);
    // The pair is validated TOGETHER (a specialty is only meaningful under its parent),
    // so a patch that moves the discipline without restating the specialty clears the
    // leaf rather than leaving it hanging off a branch that no longer exists.
    const category = b.discipline === undefined && b.specialty === undefined
      ? null
      : normalizeCategory(b.discipline ?? null, b.specialty ?? null);
    // The shape has to be known before the money can be checked, and a patch may change
    // only one of them — so the CURRENT shape is the fallback.
    const [current] = await db
      .select({ engagementType: jobPostings.engagementType })
      .from(jobPostings)
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)))
      .limit(1);
    if (!current) return c.json({ error: 'Not found' }, 404);
    let budget;
    try {
      budget = normalizeBudget({
        engagementType: engagementType ?? hireShape(current.engagementType),
        rateMinCents: b.rateMinCents,
        rateMaxCents: b.rateMaxCents,
        budgetTotalCents: b.budgetTotalCents,
      });
    } catch (error) {
      if (error instanceof BudgetShapeError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const questions = b.screeningQuestions === undefined ? null : normalizeScreeningQuestions(b.screeningQuestions);
    const rows = await db
      .update(jobPostings)
      .set({
        status:           sql`COALESCE(${status}, status)`,
        title:            sql`COALESCE(${typeof b.title === 'string' ? b.title.slice(0, 200) : null}, title)`,
        description:      sql`COALESCE(${typeof b.description === 'string' ? b.description.slice(0, 5000) : null}, description)`,
        requirements:     sql`COALESCE(${typeof b.requirements === 'string' ? b.requirements.slice(0, 8000) : null}, requirements)`,
        postingType:      sql`COALESCE(${postingType}, posting_type)`,
        engagementType:   sql`COALESCE(${engagementType}, engagement_type)`,
        rateMinCents:     sql`COALESCE(${budget.rateMinCents}, rate_min_cents)`,
        rateMaxCents:     sql`COALESCE(${budget.rateMaxCents}, rate_max_cents)`,
        budgetTotalCents: sql`COALESCE(${budget.budgetTotalCents}, budget_total_cents)`,
        experienceLevel:  sql`COALESCE(${experienceLevel(b.experienceLevel)}, experience_level)`,
        projectLength:    sql`COALESCE(${projectLength(b.projectLength)}, project_length)`,
        discipline:       sql`COALESCE(${category?.discipline ?? null}, discipline)`,
        // The leaf is set from the pair, and only when the caller mentioned either half.
        specialty:        category === null ? sql`specialty` : category.specialty,
        ...(questions === null ? {} : { screeningQuestions: questions }),
        closedAt:         sql`CASE WHEN ${status} IN ('closed', 'filled') THEN NOW() ELSE closed_at END`,
        updatedAt:        sql`NOW()`,
      })
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)))
      .returning({ id: jobPostings.id, source_ticket_id: jobPostings.sourceTicketId });
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    // Every cache a posting write dirties, in one call — including the per-ticket board
    // badge, which the old inline invalidation here forgot.
    await invalidatePostingCaches(c.env as Env, tenantId, updated.source_ticket_id);
    return c.json({ ok: true });
  });

  // ---- Public browse + bid ----

  // GET / — browse OPEN jobs. Public jobs are world-browsable; the open-public
  // slice is cached and filtered (discipline/skill/q) in memory.
  router.get('/', async (c) => {
    const db = buildDatabase(c.env);
    // The criteria are normalised and lowered to SQL by `jobFilters`, which is also
    // what the job-alert sweep matches with — one declaration of what a job search
    // MEANS, two evaluators. Writing the predicate inline here a second time is how
    // an alert comes to disagree with the board the seeker is looking at.
    const spec = normalizeJobFilters(c.req.query());
    const hasFilters = !jobFilterIsEmpty(spec);
    const conditions = [
      eq(jobPostings.status, 'open'),
      eq(jobPostings.visibility, 'public'),
      ...jobFilterConditions(spec),
    ];
    const loadJobs = () =>
      db
        .select({
          ...jobColumns,
          tenant_name: tenants.name,
          client_rating: clientRatingSql,
          client_rating_count: clientRatingCountSql,
        })
        .from(jobPostings)
        .innerJoin(tenants, eq(tenants.id, jobPostings.tenantId))
        .where(and(...conditions))
        .orderBy(desc(jobPostings.createdAt))
        .limit(200);
    const jobs = hasFilters
      ? await loadJobs()
      : await getOrSetCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY, loadJobs);
    return c.json(jobs.map(mapJob));
  });

  // GET /:id — job detail. Private jobs need a signed-in viewer.
  router.get('/:id', async (c) => {
    const db = buildDatabase(c.env);
    const id = c.req.param('id');
    const viewer = await optionalUserId(c);
    const [job] = await db
      .select({
        ...jobColumns,
        tenant_name: tenants.name,
        client_rating: clientRatingSql,
        client_rating_count: clientRatingCountSql,
      })
      .from(jobPostings)
      .innerJoin(tenants, eq(tenants.id, jobPostings.tenantId))
      .where(eq(jobPostings.id, id));
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.visibility === 'private' && !viewer) return c.json({ error: 'Sign in to view this job', code: 'AUTH_REQUIRED' }, 401);
    // The posting's published payment schedule is part of the OFFER, so it is as public
    // as the description: a fixed-price bid made without seeing the deliverables and the
    // money attached to them is a bid on a different job. The tenant comes off the row
    // rather than from the caller — this route has no tenant JWT.
    const postingSchedule = await readJobSchedule(db, Number(job.tenant_id), id);
    let myProposal: unknown = null;
    let myInvite: unknown = null;
    if (viewer) {
      // The invite the VIEWER holds on this posting, so the detail page can offer
      // "accept and bid" in place of a plain bid button. Their own row only — scoped by
      // the verified subject, never by a parameter.
      myInvite = (await readInvitesForUser(db, viewer)).find((invite) => invite.jobId === id) ?? null;
      const [mine] = await db
        .select({ id: jobProposals.id, status: jobProposals.status })
        .from(jobProposals)
        .where(and(eq(jobProposals.jobId, id), eq(jobProposals.freelancerUserId, viewer)));
      // A bidder reads back their OWN counter-offer — scoped to their proposal, so this
      // never exposes a rival's. Skipped for a `saved` row, which is a bookmark and has
      // no schedule to show.
      if (mine) {
        myProposal = {
          id: mine.id,
          status: mine.status,
          milestones: mine.status === 'saved' ? [] : await readProposalSchedule(db, Number(job.tenant_id), mine.id),
        };
      }
    }
    return c.json({ ...mapJob(job), milestones: postingSchedule, myProposal, myInvite });
  });

  // GET /:id/attachments/:attachmentId — a posting's brief, as public as its description.
  //
  // A posting's attachments are part of the OFFER. Locking them behind the employer's
  // tenant token would mean bidders could read the scope and not the spec they were being
  // asked to price, which is a bid on a different job. So the access rule is exactly the
  // one `GET /:id` already applies: public postings are world-readable, a private one
  // needs a signed-in viewer. The cross-tenant read is declared with the same
  // public-catalogue reason and the same predicate as the anonymous browse.
  router.get('/:id/attachments/:attachmentId', async (c) => {
    const db = buildDatabase(c.env);
    const id = c.req.param('id');
    const [job] = await db
      .select({ visibility: jobPostings.visibility, attachments: jobPostings.attachments })
      .from(jobPostings)
      .where(acrossTenants(jobPostings, 'public_catalogue', eq(jobPostings.id, id)))
      .limit(1);
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.visibility === 'private' && !(await optionalUserId(c))) {
      return c.json({ error: 'Sign in to view this job', code: 'AUTH_REQUIRED' }, 401);
    }
    return serveAttachment(c.env as Env, normalizeAttachments(job.attachments), c.req.param('attachmentId'));
  });

  // POST /:id/proposals — FREELANCER bids on a job.
  router.post('/:id/proposals', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ coverNote?: string; rateCents?: number; milestones?: unknown; screeningAnswers?: unknown }>();
    const [job] = await db
      .select({
        id: jobPostings.id,
        tenant_id: jobPostings.tenantId,
        title: jobPostings.title,
        created_by_user_id: jobPostings.createdByUserId,
        status: jobPostings.status,
        visibility: jobPostings.visibility,
        screening_questions: jobPostings.screeningQuestions,
      })
      .from(jobPostings)
      .where(eq(jobPostings.id, id));
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.status !== 'open') return c.json({ error: 'This job is no longer open' }, 409);
    if (job.visibility === 'private') {
      // TWO ways in, and the second one is why invites are rows. An ACTIVE engagement is
      // the standing relationship; a LIVE INVITE is the client having asked this specific
      // person. Inviting a stranger to a private posting and then refusing their bid
      // would be the product contradicting itself in two clicks.
      const [relationship] = await db.select({ id: freelancerEngagements.id })
        .from(freelancerEngagements)
        .where(and(
          eq(freelancerEngagements.tenantId, Number(job.tenant_id)),
          eq(freelancerEngagements.freelancerUserId, userId),
          isNull(freelancerEngagements.terminatedAt),
        )).limit(1);
      if (!relationship && !(await hasLiveInvite(db, id, userId))) {
        return c.json({ error: 'This private job is not available to this account' }, 403);
      }
    }
    // Must be open to being hired — a dedicated freelancer account OR a builder who
    // opted in (available_for_hire). Keyed on the opt-in flag, not the account type,
    // so opted-in builders can bid too.
    const [me] = await db
      .select({ available_for_hire: users.availableForHire, display_name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    if (!me || !me.available_for_hire) return c.json({ error: 'Enable "Available for hire" to bid on gigs' }, 403);
    // Screening answers are checked against the questions the posting ASKS RIGHT NOW, and
    // each stored answer freezes the prompt it answered — so an employer who rewrites a
    // question tomorrow cannot retroactively change what this person was asked. A missing
    // REQUIRED answer is refused, and it names the questions rather than saying "invalid".
    const questions = normalizeScreeningQuestions(job.screening_questions);
    const screening = normalizeScreeningAnswers(b.screeningAnswers, questions);
    if (screening.missingRequired.length > 0) {
      return c.json({ error: 'Answer the required screening questions', code: 'SCREENING_REQUIRED', questions: screening.missingRequired }, 400);
    }
    const [bid] = await db
      .insert(jobProposals)
      .values({
        id: crypto.randomUUID(),
        jobId: id,
        freelancerUserId: userId,
        coverNote: typeof b.coverNote === 'string' ? b.coverNote.slice(0, 3000) : null,
        rateCents: typeof b.rateCents === 'number' ? Math.round(b.rateCents) : null,
        screeningAnswers: screening.answers,
      })
      .onConflictDoUpdate({
        target: [jobProposals.jobId, jobProposals.freelancerUserId],
        set: {
          coverNote: sql`excluded.cover_note`,
          rateCents: sql`excluded.rate_cents`,
          // A revision replaces the answers wholesale — one bid is one set of answers,
          // not an accumulation. Attachments are NOT touched: they are uploaded by their
          // own route after the row exists, and re-submitting a revised cover note must
          // not delete the work samples already attached to it.
          screeningAnswers: sql`excluded.screening_answers`,
          status: 'submitted',
          updatedAt: sql`NOW()`,
        },
      })
      // The id must come BACK from the statement. Bidding is an upsert — a revised bid
      // updates the row that already exists — so returning the uuid this request minted
      // would hand the caller an id that names nothing, and every follow-up keyed on it
      // (its schedule, its withdrawal) would 404.
      .returning({ id: jobProposals.id });
    // An upsert that neither inserts nor updates cannot happen here — the conflict
    // target always resolves to a row — but the row is what every follow-up is keyed
    // on, so a missing one is refused rather than papered over with a minted id.
    if (!bid) return c.json({ error: 'Could not record this proposal' }, 409);
    const pid = bid.id;
    // The bidder's own proposed schedule — the other direction of the negotiation. A
    // freelancer who disagrees with the published deliverables could previously only say
    // so in prose; these are rows the accept path can bind and the escrow machine can
    // fund. Replaces on every submit, because a revised bid is one offer, not two.
    const lines = proposedMilestones(b.milestones);
    if (lines.length > 0) {
      await replaceProposalSchedule(db, {
        tenantId: Number(job.tenant_id),
        jobId: id,
        proposalId: pid,
        freelancerUserId: userId,
        lines,
      });
    }
    // Applying makes this person a CANDIDATE of the hiring workspace: it registers the
    // party role every consent/retention/diversity read is keyed on, and snapshots the
    // résumé they applied with into the employer's own tenant. Never throws — the bid
    // is what the person asked for; this is the employer's record of it.
    const intake = await admitCandidate(db, {
      userId,
      tenantId: Number(job.tenant_id),
      source: 'job_proposal',
      // NAMING THE POSTING is what puts this person into the employer's ATS pipeline
      // rather than merely into their candidate list. Without it `admitCandidate` records
      // the party role and stops, and a marketplace bid would be invisible to the hiring
      // surface that exists to review it — a candidate with no application. The cover note
      // rides along because it IS the application's letter; the proposal is the same act.
      jobPostingId: id,
      coverLetter: typeof b.coverNote === 'string' ? b.coverNote.slice(0, 3000) : null,
      env: c.env as Env,
    });
    if (job.created_by_user_id) {
      await notify(db, c.env, { userId: job.created_by_user_id, tenantId: Number(job.tenant_id), kind: 'proposal', title: `${me.display_name ?? 'A freelancer'} bid on "${job.title}"`, ref: id });
    }
    return c.json({ id: pid, resumeAttached: intake.resumeProjected, proposedMilestones: lines.length }, 201);
  });

  return router;
}

export function createNotificationRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET / — the signed-in user's notification feed + unread count.
  router.get('/', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const [rows, unreadRows] = await Promise.all([db
      .select({
        id:         freelancerNotifications.id,
        kind:       freelancerNotifications.kind,
        title:      freelancerNotifications.title,
        body:       freelancerNotifications.body,
        ref:        freelancerNotifications.ref,
        read_at:    freelancerNotifications.readAt,
        created_at: freelancerNotifications.createdAt,
      })
      .from(freelancerNotifications)
      .where(eq(freelancerNotifications.userId, userId))
      .orderBy(desc(freelancerNotifications.createdAt))
      .limit(100),
      db.select({ value: sql<number>`count(*)::int` })
        .from(freelancerNotifications)
        .where(and(eq(freelancerNotifications.userId, userId), isNull(freelancerNotifications.readAt))),
    ]);
    const unread = Number(unreadRows[0]?.value ?? 0);
    return c.json({
      unread,
      items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body ?? null, ref: r.ref ?? null, read: r.read_at != null, createdAt: r.created_at })),
    });
  });

  // POST /read — mark all (or a given set of) notifications read.
  router.post('/read', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    let ids: number[] | null = null;
    try { const b = await c.req.json<{ ids?: number[] }>(); ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite) : null; } catch (error) { /* mark all */ 
      reportCaughtError(error, { source: "presentation/routes/jobRoutes.ts", operation: "createNotificationRoutes" });
    }
    if (ids && ids.length > 0) {
      await db
        .update(freelancerNotifications)
        .set({ readAt: sql`NOW()` })
        .where(and(eq(freelancerNotifications.userId, userId), inArray(freelancerNotifications.id, ids), isNull(freelancerNotifications.readAt)));
    } else {
      await db
        .update(freelancerNotifications)
        .set({ readAt: sql`NOW()` })
        .where(and(eq(freelancerNotifications.userId, userId), isNull(freelancerNotifications.readAt)));
    }
    return c.json({ ok: true });
  });

  return router;
}
