/**
 * Job postings + proposals (the bidding side of the freelance marketplace) and the
 * in-app notification feed.
 *
 *   /api/jobs/*           — employers post work; freelancers browse + bid; employers
 *                           review proposals and accept one → creates an engagement.
 *   /api/notifications/*  — the recipient's in-app feed (both sides).
 *
 * Employer actions use the TENANT JWT; freelancer actions use the WEB JWT.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { parseJsonArray } from '../../domain/shared/json';
import type { Env, HonoEnv } from '../../env';

const JOBS_PUBLIC_CACHE_KEY = 'jobs:public:open';
const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'];

function parseSkills(raw: unknown): string[] {
  return parseJsonArray<string>(raw);
}

async function optionalUserId(c: { req: { header(n: string): string | undefined }; env: HonoEnv['Bindings'] }): Promise<string | null> {
  const h = c.req.header('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  try { const p = await verifyWebJwt(h.slice(7), c.env.JWT_SECRET); return p.sub ?? null; } catch { return null; }
}

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
  proposalCount: r.proposal_count == null ? undefined : Number(r.proposal_count),
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
  createdAt: r.created_at ?? null,
});

export function createJobRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // ---- Freelancer: my proposals (registered before /:id so it isn't swallowed) ----
  router.get('/proposals/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT pr.*, j.title AS job_title FROM job_proposals pr JOIN job_postings j ON j.id = pr.job_id
      WHERE pr.freelancer_user_id = ${userId} ORDER BY pr.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapProposal));
  });

  // POST /proposals/:pid/withdraw — freelancer withdraws their bid.
  router.post('/proposals/:pid/withdraw', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const rows = await sql(c.env)`
      UPDATE job_proposals SET status = 'withdrawn', updated_at = NOW()
      WHERE id = ${pid} AND freelancer_user_id = ${userId} AND status IN ('submitted', 'shortlisted') RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // POST /proposals/:pid/accept — EMPLOYER accepts a proposal → creates an active
  // engagement, marks the job filled, and notifies the freelancer.
  router.post('/proposals/:pid/accept', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const pid = c.req.param('pid');
    const [pr] = await sql(c.env)`
      SELECT pr.*, j.tenant_id AS job_tenant, j.project_id, j.title AS job_title
      FROM job_proposals pr JOIN job_postings j ON j.id = pr.job_id WHERE pr.id = ${pid}
    `;
    if (!pr || Number(pr.job_tenant) !== Number(tenantId)) return c.json({ error: 'Not found' }, 404);
    // Reuse or create an active engagement for this freelancer + project.
    const projectId = pr.project_id == null ? null : Number(pr.project_id);
    const [existing] = await sql(c.env)`
      SELECT id FROM freelancer_engagements
      WHERE tenant_id = ${tenantId} AND freelancer_user_id = ${pr.freelancer_user_id}
        AND COALESCE(project_id, 0) = COALESCE(${projectId}, 0) AND terminated_at IS NULL
    `;
    let engagementId: string;
    if (existing) {
      engagementId = existing.id as string;
      await sql(c.env)`UPDATE freelancer_engagements SET status = 'active', hired_at = COALESCE(hired_at, NOW()), rate_cents = ${pr.rate_cents}, updated_at = NOW() WHERE id = ${engagementId}`;
    } else {
      engagementId = crypto.randomUUID();
      await sql(c.env)`
        INSERT INTO freelancer_engagements (id, tenant_id, project_id, freelancer_user_id, status, rate_cents, currency, title, created_by_user_id, hired_at)
        VALUES (${engagementId}, ${tenantId}, ${projectId}, ${pr.freelancer_user_id}, 'active', ${pr.rate_cents}, ${pr.currency ?? 'USD'}, ${pr.job_title}, ${actor}, NOW())
      `;
    }
    await sql(c.env)`UPDATE job_proposals SET status = 'accepted', updated_at = NOW() WHERE id = ${pid}`;
    await sql(c.env)`UPDATE job_postings SET status = 'filled', updated_at = NOW() WHERE id = ${pr.job_id}`;
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    const [ten] = await sql(c.env)`SELECT name FROM tenants WHERE id = ${tenantId}`;
    await notify(sql(c.env), c.env, { userId: pr.freelancer_user_id as string, tenantId, kind: 'hired', title: `${(ten?.name as string) ?? 'A workspace'} accepted your proposal for "${pr.job_title}"`, ref: engagementId });
    return c.json({ ok: true, engagementId });
  });

  // POST /proposals/:pid/decline — EMPLOYER declines a proposal.
  router.post('/proposals/:pid/decline', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const pid = c.req.param('pid');
    const rows = await sql(c.env)`
      UPDATE job_proposals pr SET status = 'declined', updated_at = NOW()
      FROM job_postings j WHERE pr.job_id = j.id AND pr.id = ${pid} AND j.tenant_id = ${tenantId} AND pr.status IN ('submitted', 'shortlisted')
      RETURNING pr.freelancer_user_id, pr.job_id
    `;
    const declined = rows[0];
    if (!declined) return c.json({ error: 'Not found' }, 404);
    await notify(sql(c.env), c.env, { userId: declined.freelancer_user_id as string, tenantId, kind: 'declined', title: 'A proposal was declined', ref: declined.job_id as string });
    return c.json({ ok: true });
  });

  // ---- Employer: my jobs ----
  router.get('/mine', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT j.*, (SELECT COUNT(*) FROM job_proposals p WHERE p.job_id = j.id AND p.status NOT IN ('withdrawn'))::int AS proposal_count
      FROM job_postings j WHERE j.tenant_id = ${tenantId} ORDER BY j.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapJob));
  });

  // GET /:id/proposals — EMPLOYER views proposals on their job.
  router.get('/:id/proposals', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [job] = await sql(c.env)`SELECT id FROM job_postings WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!job) return c.json({ error: 'Not found' }, 404);
    const rows = await sql(c.env)`
      SELECT pr.*, u.display_name AS freelancer_name FROM job_proposals pr JOIN users u ON u.id = pr.freelancer_user_id
      WHERE pr.job_id = ${id} ORDER BY pr.created_at DESC
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapProposal));
  });

  // POST / — EMPLOYER posts a job.
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<Record<string, unknown>>();
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
    if (!title) return c.json({ error: 'title required' }, 400);
    const discipline = DISCIPLINES.includes(b.discipline as string) ? (b.discipline as string) : null;
    const skills = Array.isArray(b.skills) ? JSON.stringify((b.skills as unknown[]).filter((s) => typeof s === 'string').slice(0, 30)) : null;
    const id = crypto.randomUUID();
    await sql(c.env)`
      INSERT INTO job_postings (id, tenant_id, project_id, title, description, discipline, skills, rate_min_cents, rate_max_cents, currency, visibility, created_by_user_id)
      VALUES (${id}, ${tenantId}, ${typeof b.projectId === 'number' ? b.projectId : null}, ${title}, ${typeof b.description === 'string' ? b.description.slice(0, 5000) : null},
        ${discipline}, ${skills}, ${typeof b.rateMinCents === 'number' ? Math.round(b.rateMinCents) : null}, ${typeof b.rateMaxCents === 'number' ? Math.round(b.rateMaxCents) : null},
        ${typeof b.currency === 'string' ? (b.currency as string).slice(0, 3).toUpperCase() : 'USD'}, ${b.visibility === 'private' ? 'private' : 'public'}, ${actor})
    `;
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    return c.json({ id }, 201);
  });

  // PATCH /:id — EMPLOYER edits or closes a job.
  router.patch('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string; title?: string; description?: string }>();
    const status = ['open', 'closed', 'filled'].includes(b.status ?? '') ? (b.status as string) : null;
    const rows = await sql(c.env)`
      UPDATE job_postings SET
        status = COALESCE(${status}, status),
        title = COALESCE(${typeof b.title === 'string' ? b.title.slice(0, 200) : null}, title),
        description = COALESCE(${typeof b.description === 'string' ? b.description.slice(0, 5000) : null}, description),
        closed_at = CASE WHEN ${status} IN ('closed', 'filled') THEN NOW() ELSE closed_at END,
        updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY);
    return c.json({ ok: true });
  });

  // ---- Public browse + bid ----

  // GET / — browse OPEN jobs. Public jobs are world-browsable; the open-public
  // slice is cached and filtered (discipline/skill/q) in memory.
  router.get('/', async (c) => {
    const q = c.req.query();
    const jobs = await getOrSetCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY, () =>
      sql(c.env)`
        SELECT j.*, t.name AS tenant_name FROM job_postings j JOIN tenants t ON t.id = j.tenant_id
        WHERE j.status = 'open' AND j.visibility = 'public' ORDER BY j.created_at DESC LIMIT 200
      ` as unknown as Promise<Record<string, unknown>[]>,
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
    const id = c.req.param('id');
    const viewer = await optionalUserId(c);
    const [job] = await sql(c.env)`
      SELECT j.*, t.name AS tenant_name FROM job_postings j JOIN tenants t ON t.id = j.tenant_id WHERE j.id = ${id}
    `;
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.visibility === 'private' && !viewer) return c.json({ error: 'Sign in to view this job', code: 'AUTH_REQUIRED' }, 401);
    let myProposal: unknown = null;
    if (viewer) {
      const [mine] = await sql(c.env)`SELECT id, status FROM job_proposals WHERE job_id = ${id} AND freelancer_user_id = ${viewer}`;
      if (mine) myProposal = { id: mine.id, status: mine.status };
    }
    return c.json({ ...mapJob(job), myProposal });
  });

  // POST /:id/proposals — FREELANCER bids on a job.
  router.post('/:id/proposals', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ coverNote?: string; rateCents?: number }>();
    const [job] = await sql(c.env)`SELECT id, tenant_id, title, created_by_user_id, status FROM job_postings WHERE id = ${id}`;
    if (!job) return c.json({ error: 'Not found' }, 404);
    if (job.status !== 'open') return c.json({ error: 'This job is no longer open' }, 409);
    // Must be open to being hired — a dedicated freelancer account OR a builder who
    // opted in (available_for_hire). Keyed on the opt-in flag, not the account type,
    // so opted-in builders can bid too.
    const [me] = await sql(c.env)`SELECT available_for_hire, display_name FROM users WHERE id = ${userId}`;
    if (!me || !me.available_for_hire) return c.json({ error: 'Enable "Available for hire" to bid on gigs' }, 403);
    const pid = crypto.randomUUID();
    await sql(c.env)`
      INSERT INTO job_proposals (id, job_id, freelancer_user_id, cover_note, rate_cents)
      VALUES (${pid}, ${id}, ${userId}, ${typeof b.coverNote === 'string' ? b.coverNote.slice(0, 3000) : null}, ${typeof b.rateCents === 'number' ? Math.round(b.rateCents) : null})
      ON CONFLICT (job_id, freelancer_user_id) DO UPDATE SET cover_note = EXCLUDED.cover_note, rate_cents = EXCLUDED.rate_cents, status = 'submitted', updated_at = NOW()
    `;
    if (job.created_by_user_id) {
      await notify(sql(c.env), c.env, { userId: job.created_by_user_id as string, tenantId: Number(job.tenant_id), kind: 'proposal', title: `${(me.display_name as string) ?? 'A freelancer'} bid on "${job.title}"`, ref: id });
    }
    return c.json({ id: pid }, 201);
  });

  return router;
}

export function createNotificationRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  // GET / — the signed-in user's notification feed + unread count.
  router.get('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT id, kind, title, body, ref, read_at, created_at FROM freelancer_notifications
      WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100
    ` as unknown as Record<string, unknown>[];
    const unread = rows.filter((r) => r.read_at == null).length;
    return c.json({
      unread,
      items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body ?? null, ref: r.ref ?? null, read: r.read_at != null, createdAt: r.created_at })),
    });
  });

  // POST /read — mark all (or a given set of) notifications read.
  router.post('/read', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    let ids: number[] | null = null;
    try { const b = await c.req.json<{ ids?: number[] }>(); ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite) : null; } catch { /* mark all */ }
    if (ids && ids.length > 0) {
      await sql(c.env)`UPDATE freelancer_notifications SET read_at = NOW() WHERE user_id = ${userId} AND id = ANY(${ids}) AND read_at IS NULL`;
    } else {
      await sql(c.env)`UPDATE freelancer_notifications SET read_at = NOW() WHERE user_id = ${userId} AND read_at IS NULL`;
    }
    return c.json({ ok: true });
  });

  return router;
}
