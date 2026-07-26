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
import {
  freelancerEngagements,
  freelancerNotifications,
  jobPostings,
  jobProposals,
  proposalEvaluations,
  tasks,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { parseJsonArray } from '../../domain/shared/json';
import { resolveTenantPlan } from './llmRoutes';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { evaluateProposal, evalPercent } from '../../application/marketplace/proposalEval';
import type { EvalJudge } from '../../application/eval/semanticEval';
import type { Env, HonoEnv } from '../../env';

const JOBS_PUBLIC_CACHE_KEY = 'jobs:public:open';
const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'];
const POSTING_TYPES = ['project_bid', 'design', 'fte'];
const ENGAGEMENT_TYPES = ['fixed_bid', 'hourly', 'fte'];

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
  createdAt: r.created_at ?? null,
});

export function createJobRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

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

  // POST /proposals/:pid/accept — EMPLOYER accepts a proposal → creates an active
  // engagement, marks the job filled, and notifies the freelancer.
  router.post('/proposals/:pid/accept', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const pid = c.req.param('pid');
    const [pr] = await db
      .select({
        ...proposalColumns,
        job_tenant: jobPostings.tenantId,
        project_id: jobPostings.projectId,
        job_title: jobPostings.title,
      })
      .from(jobProposals)
      .innerJoin(jobPostings, eq(jobPostings.id, jobProposals.jobId))
      .where(eq(jobProposals.id, pid));
    if (!pr || Number(pr.job_tenant) !== Number(tenantId)) return c.json({ error: 'Not found' }, 404);
    // Reuse or create an active engagement for this freelancer + project.
    const projectId = pr.project_id == null ? null : Number(pr.project_id);
    const [existing] = await db
      .select({ id: freelancerEngagements.id })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.freelancerUserId, pr.freelancer_user_id),
        sql`COALESCE(${freelancerEngagements.projectId}, 0) = COALESCE(${projectId}, 0)`,
        isNull(freelancerEngagements.terminatedAt),
      ));
    let engagementId: string;
    if (existing) {
      engagementId = existing.id;
      await db
        .update(freelancerEngagements)
        .set({ status: 'active', hiredAt: sql`COALESCE(hired_at, NOW())`, rateCents: pr.rate_cents, updatedAt: sql`NOW()` })
        .where(eq(freelancerEngagements.id, engagementId));
    } else {
      engagementId = crypto.randomUUID();
      await db.insert(freelancerEngagements).values({
        id: engagementId,
        tenantId,
        projectId,
        freelancerUserId: pr.freelancer_user_id,
        status: 'active',
        rateCents: pr.rate_cents,
        currency: pr.currency ?? 'USD',
        title: pr.job_title,
        createdByUserId: actor,
        hiredAt: sql`NOW()`,
      });
    }
    await db.update(jobProposals).set({ status: 'accepted', updatedAt: sql`NOW()` }).where(eq(jobProposals.id, pid));
    await db.update(jobPostings).set({ status: 'filled', updatedAt: sql`NOW()` }).where(eq(jobPostings.id, pr.job_id));
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    const [ten] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    await notify(db, c.env, { userId: pr.freelancer_user_id, tenantId, kind: 'hired', title: `${ten?.name ?? 'A workspace'} accepted your proposal for "${pr.job_title}"`, ref: engagementId });
    return c.json({ ok: true, engagementId });
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
    const rows = await db
      .select({ ...proposalColumns, freelancer_name: users.displayName })
      .from(jobProposals)
      .innerJoin(users, eq(users.id, jobProposals.freelancerUserId))
      .where(eq(jobProposals.jobId, id))
      .orderBy(desc(jobProposals.createdAt));
    return c.json(rows.map(mapProposal));
  });

  // POST / — EMPLOYER posts a job.
  router.post('/', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<Record<string, unknown>>();
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
    if (!title) return c.json({ error: 'title required' }, 400);
    const discipline = DISCIPLINES.includes(b.discipline as string) ? (b.discipline as string) : null;
    const skills = Array.isArray(b.skills) ? JSON.stringify((b.skills as unknown[]).filter((s) => typeof s === 'string').slice(0, 30)) : null;
    const postingType = POSTING_TYPES.includes(b.postingType as string) ? (b.postingType as string) : 'project_bid';
    const engagementType = ENGAGEMENT_TYPES.includes(b.engagementType as string) ? (b.engagementType as string) : null;
    const requirements = typeof b.requirements === 'string' ? b.requirements.slice(0, 8000) : null;
    const sourceTicketId = typeof b.sourceTicketId === 'number' ? Math.round(b.sourceTicketId) : null;
    const id = crypto.randomUUID();
    await db.insert(jobPostings).values({
      id,
      tenantId,
      projectId: typeof b.projectId === 'number' ? b.projectId : null,
      title,
      description: typeof b.description === 'string' ? b.description.slice(0, 5000) : null,
      discipline,
      skills,
      rateMinCents: typeof b.rateMinCents === 'number' ? Math.round(b.rateMinCents) : null,
      rateMaxCents: typeof b.rateMaxCents === 'number' ? Math.round(b.rateMaxCents) : null,
      currency: typeof b.currency === 'string' ? (b.currency as string).slice(0, 3).toUpperCase() : 'USD',
      visibility: b.visibility === 'private' ? 'private' : 'public',
      postingType,
      engagementType,
      requirements,
      sourceTicketId,
      createdByUserId: actor,
    });
    // Keep the ticket's hireable back-ref in sync when a posting is created FROM a ticket.
    if (sourceTicketId != null) {
      await db.update(tasks).set({ hireable: true, jobPostingId: id }).where(eq(tasks.id, sourceTicketId));
    }
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    return c.json({ id }, 201);
  });

  // PATCH /:id — EMPLOYER edits or closes a job.
  router.patch('/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string; title?: string; description?: string; requirements?: string; postingType?: string; engagementType?: string }>();
    const status = ['open', 'closed', 'filled'].includes(b.status ?? '') ? (b.status as string) : null;
    const postingType = POSTING_TYPES.includes(b.postingType ?? '') ? (b.postingType as string) : null;
    const engagementType = ENGAGEMENT_TYPES.includes(b.engagementType ?? '') ? (b.engagementType as string) : null;
    const rows = await db
      .update(jobPostings)
      .set({
        status:         sql`COALESCE(${status}, status)`,
        title:          sql`COALESCE(${typeof b.title === 'string' ? b.title.slice(0, 200) : null}, title)`,
        description:    sql`COALESCE(${typeof b.description === 'string' ? b.description.slice(0, 5000) : null}, description)`,
        requirements:   sql`COALESCE(${typeof b.requirements === 'string' ? b.requirements.slice(0, 8000) : null}, requirements)`,
        postingType:    sql`COALESCE(${postingType}, posting_type)`,
        engagementType: sql`COALESCE(${engagementType}, engagement_type)`,
        closedAt:       sql`CASE WHEN ${status} IN ('closed', 'filled') THEN NOW() ELSE closed_at END`,
        updatedAt:      sql`NOW()`,
      })
      .where(and(eq(jobPostings.id, id), eq(jobPostings.tenantId, tenantId)))
      .returning({ id: jobPostings.id });
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    return c.json({ ok: true });
  });

  // ---- Public browse + bid ----

  // GET / — browse OPEN jobs. Public jobs are world-browsable; the open-public
  // slice is cached and filtered (discipline/skill/q) in memory.
  router.get('/', async (c) => {
    const db = buildDatabase(c.env);
    const q = c.req.query();
    const jobs = await getOrSetCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY, () =>
      db
        .select({
          ...jobColumns,
          tenant_name: tenants.name,
          client_rating: clientRatingSql,
          client_rating_count: clientRatingCountSql,
        })
        .from(jobPostings)
        .innerJoin(tenants, eq(tenants.id, jobPostings.tenantId))
        .where(and(eq(jobPostings.status, 'open'), eq(jobPostings.visibility, 'public')))
        .orderBy(desc(jobPostings.createdAt))
        .limit(200),
    );
    const qq = (q.q ?? '').trim().toLowerCase();
    const filtered = jobs.filter((j) => {
      if (q.discipline && String(j.discipline ?? '') !== q.discipline) return false;
      const skills = parseSkills(j.skills).map((s) => s.toLowerCase());
      if (q.skill && !skills.includes(q.skill.toLowerCase())) return false;
      if (qq && !`${j.title ?? ''} ${j.description ?? ''} ${skills.join(' ')}`.toLowerCase().includes(qq)) return false;
      return true;
    });
    return c.json(filtered.map(mapJob));
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
    let myProposal: unknown = null;
    if (viewer) {
      const [mine] = await db
        .select({ id: jobProposals.id, status: jobProposals.status })
        .from(jobProposals)
        .where(and(eq(jobProposals.jobId, id), eq(jobProposals.freelancerUserId, viewer)));
      if (mine) myProposal = { id: mine.id, status: mine.status };
    }
    return c.json({ ...mapJob(job), myProposal });
  });

  // POST /:id/proposals — FREELANCER bids on a job.
  router.post('/:id/proposals', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ coverNote?: string; rateCents?: number }>();
    const [job] = await db
      .select({
        id: jobPostings.id,
        tenant_id: jobPostings.tenantId,
        title: jobPostings.title,
        created_by_user_id: jobPostings.createdByUserId,
        status: jobPostings.status,
      })
      .from(jobPostings)
      .where(eq(jobPostings.id, id));
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.status !== 'open') return c.json({ error: 'This job is no longer open' }, 409);
    // Must be open to being hired — a dedicated freelancer account OR a builder who
    // opted in (available_for_hire). Keyed on the opt-in flag, not the account type,
    // so opted-in builders can bid too.
    const [me] = await db
      .select({ available_for_hire: users.availableForHire, display_name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    if (!me || !me.available_for_hire) return c.json({ error: 'Enable "Available for hire" to bid on gigs' }, 403);
    const pid = crypto.randomUUID();
    await db
      .insert(jobProposals)
      .values({
        id: pid,
        jobId: id,
        freelancerUserId: userId,
        coverNote: typeof b.coverNote === 'string' ? b.coverNote.slice(0, 3000) : null,
        rateCents: typeof b.rateCents === 'number' ? Math.round(b.rateCents) : null,
      })
      .onConflictDoUpdate({
        target: [jobProposals.jobId, jobProposals.freelancerUserId],
        set: {
          coverNote: sql`excluded.cover_note`,
          rateCents: sql`excluded.rate_cents`,
          status: 'submitted',
          updatedAt: sql`NOW()`,
        },
      });
    if (job.created_by_user_id) {
      await notify(db, c.env, { userId: job.created_by_user_id, tenantId: Number(job.tenant_id), kind: 'proposal', title: `${me.display_name ?? 'A freelancer'} bid on "${job.title}"`, ref: id });
    }
    return c.json({ id: pid }, 201);
  });

  return router;
}

export function createNotificationRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET / — the signed-in user's notification feed + unread count.
  router.get('/', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const rows = await db
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
      .limit(100);
    const unread = rows.filter((r) => r.read_at == null).length;
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
      console.error('[suppressed-error] presentation/routes/jobRoutes.ts:587 createNotificationRoutes', { error });
    }
    if (ids && ids.length > 0) {
      await db
        .update(freelancerNotifications)
        .set({ readAt: sql`NOW()` })
        .where(and(
          eq(freelancerNotifications.userId, userId),
          inArray(freelancerNotifications.id, ids),
          isNull(freelancerNotifications.readAt),
        ));
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
