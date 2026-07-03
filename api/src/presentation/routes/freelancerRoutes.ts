/**
 * Freelancer marketplace routes — /api/freelancers/* and /api/engagements/*.
 *
 * A freelancer (users.account_type='freelancer') owns ONE for-hire profile
 * (skills / resume / hourly rate) with a public-or-private visibility toggle,
 * backed by hired.video. Employers browse the marketplace and HIRE freelancers
 * across many tenants/projects via engagements (invite → interview → active →
 * terminate). Public browse is world-readable for `visibility='public'` profiles;
 * `private` profiles require any signed-in user.
 *
 * Self-management uses the WEB JWT (a freelancer may not belong to a tenant).
 * Employer engagement actions use the TENANT JWT (the hiring workspace).
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  uploadResume as hiredUploadResume,
  getProfile as hiredGetProfile,
  createEmbedToken as hiredCreateEmbedToken,
  connectExisting as hiredConnectExisting,
  getByExternalUserId as hiredGetByExternalUserId,
} from '../../application/integrations/hiredVideo';
import { notify } from '../../application/notifications/notify';
import type { Env, HonoEnv } from '../../env';

export const FREELANCER_PUBLIC_LIST_CACHE_KEY = 'fl:public:list';
const PUBLIC_LIST_TTL = 120;

const DISCIPLINES = ['developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other'] as const;
const VISIBILITIES = ['public', 'private'] as const;
const AVAILABILITIES = ['open', 'limited', 'unavailable'] as const;
const RESUME_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);
const RESUME_MAX_BYTES = 10 * 1024 * 1024;

/** Parse the stored skills JSON column into a string[]. */
function parseSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

/** The PUBLIC projection — never leaks the R2 key or hired.video ids. */
function mapPublicProfile(row: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: row.user_id,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    headline: row.headline ?? null,
    bio: row.bio ?? null,
    discipline: row.discipline ?? null,
    skills: parseSkills(row.skills),
    hourlyRateCents: row.hourly_rate_cents == null ? null : Number(row.hourly_rate_cents),
    currency: row.currency ?? 'USD',
    visibility: row.visibility ?? 'private',
    availability: row.availability ?? 'open',
    location: row.location ?? null,
    timezone: row.timezone ?? null,
    hasResume: Boolean(row.hired_video_user_id) || Boolean(row.resume_key),
    rating: row.avg_rating == null ? null : Number(row.avg_rating),
    ratingCount: row.rating_count == null ? 0 : Number(row.rating_count),
    updatedAt: row.updated_at ?? null,
  };
}

/** In-memory filter/sort/paginate over the (cached) public profile list — keeps the
 *  cache key bounded (one key) while supporting talent search. Shared by the browse
 *  route. `q` matches name/headline/skills; discipline/skill/rate are exact/range. */
function applyTalentFilters(
  rows: Record<string, unknown>[],
  f: { q?: string; discipline?: string; skill?: string; minRate?: number; maxRate?: number; sort?: string; page: number; pageSize: number },
): { items: Record<string, unknown>[]; total: number } {
  const q = (f.q ?? '').trim().toLowerCase();
  let out = rows.filter((r) => {
    if (f.discipline && String(r.discipline ?? '') !== f.discipline) return false;
    const skills = parseSkills(r.skills).map((s) => s.toLowerCase());
    if (f.skill && !skills.includes(f.skill.toLowerCase())) return false;
    const rate = r.hourly_rate_cents == null ? null : Number(r.hourly_rate_cents);
    if (f.minRate != null && (rate == null || rate < f.minRate)) return false;
    if (f.maxRate != null && (rate == null || rate > f.maxRate)) return false;
    if (q) {
      const hay = `${r.display_name ?? ''} ${r.headline ?? ''} ${skills.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (f.sort === 'rate_asc') out = [...out].sort((a, b) => Number(a.hourly_rate_cents ?? Infinity) - Number(b.hourly_rate_cents ?? Infinity));
  else if (f.sort === 'rate_desc') out = [...out].sort((a, b) => Number(b.hourly_rate_cents ?? -1) - Number(a.hourly_rate_cents ?? -1));
  else if (f.sort === 'rating') out = [...out].sort((a, b) => Number(b.avg_rating ?? -1) - Number(a.avg_rating ?? -1));
  const total = out.length;
  const start = Math.max(0, (f.page - 1) * f.pageSize);
  return { items: out.slice(start, start + f.pageSize), total };
}

/** Non-throwing web-JWT probe: returns the userId when a valid web token is present. */
async function optionalUserId(c: { req: { header(n: string): string | undefined }; env: HonoEnv['Bindings'] }): Promise<string | null> {
  const h = c.req.header('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyWebJwt(h.slice(7), c.env.JWT_SECRET);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function createFreelancerRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  /** Resolve a freelancer's hired.video userId — from the stored value, else
   *  reconcile via getByExternalUserId and persist it (covers accounts that were
   *  provisioned before the partner key was configured). ONE place so the résumé,
   *  embed-token and profile paths share the linkage logic (DRY). */
  async function resolveHiredUserId(env: HonoEnv['Bindings'], userId: string, known?: string | null): Promise<string | null> {
    if (known) return known;
    const ref = await hiredGetByExternalUserId(env, userId);
    if (ref.ref?.userId) {
      await sql(env)`
        UPDATE freelancer_profiles SET hired_video_user_id = ${ref.ref.userId},
          hired_video_connection_id = COALESCE(${ref.ref.connectionId ?? null}, hired_video_connection_id), updated_at = NOW()
        WHERE user_id = ${userId}
      `;
      return ref.ref.userId;
    }
    return null;
  }

  // ------------------------------------------------------------------ SELF ----
  // Registered before the public :id route so "me" isn't swallowed by it.

  // GET /me — the signed-in freelancer's own full profile (creates a stub row on
  // first read so the edit form always has something to bind to).
  router.get('/me', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const [row] = await sql(c.env)`
      SELECT p.*, u.display_name, u.avatar_url, u.email
      FROM freelancer_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ${userId}
    `;
    if (!row) {
      await sql(c.env)`INSERT INTO freelancer_profiles (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
      const [fresh] = await sql(c.env)`
        SELECT p.*, u.display_name, u.avatar_url, u.email
        FROM freelancer_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ${userId}
      `;
      if (!fresh) return c.json({ error: 'Profile unavailable' }, 500);
      return c.json({ ...mapPublicProfile(fresh), published: false, hiredVideoConnected: Boolean(fresh.hired_video_user_id), email: fresh.email });
    }
    return c.json({
      ...mapPublicProfile(row),
      published: Boolean(row.published),
      hiredVideoConnected: Boolean(row.hired_video_user_id),
      hiredVideoClaimUrl: row.hired_video_claim_url ?? null,
      resumeFilename: row.resume_filename ?? null,
      email: row.email,
    });
  });

  // PATCH /me — update editable fields.
  router.patch('/me', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<Record<string, unknown>>();
    const headline = typeof b.headline === 'string' ? b.headline.slice(0, 200) : null;
    const bio = typeof b.bio === 'string' ? b.bio.slice(0, 5000) : null;
    const discipline = DISCIPLINES.includes(b.discipline as never) ? (b.discipline as string) : null;
    const skills = Array.isArray(b.skills) ? JSON.stringify((b.skills as unknown[]).filter((s) => typeof s === 'string').slice(0, 50)) : null;
    const rate = typeof b.hourlyRateCents === 'number' && b.hourlyRateCents >= 0 ? Math.round(b.hourlyRateCents) : null;
    const currency = typeof b.currency === 'string' ? b.currency.slice(0, 3).toUpperCase() : 'USD';
    const visibility = VISIBILITIES.includes(b.visibility as never) ? (b.visibility as string) : 'private';
    const availability = AVAILABILITIES.includes(b.availability as never) ? (b.availability as string) : 'open';
    const published = b.published === true;
    const location = typeof b.location === 'string' ? b.location.slice(0, 120) : null;
    const timezone = typeof b.timezone === 'string' ? b.timezone.slice(0, 60) : null;

    await sql(c.env)`
      INSERT INTO freelancer_profiles (user_id, headline, bio, discipline, skills, hourly_rate_cents, currency, visibility, availability, published, location, timezone, updated_at)
      VALUES (${userId}, ${headline}, ${bio}, ${discipline}, ${skills}, ${rate}, ${currency}, ${visibility}, ${availability}, ${published}, ${location}, ${timezone}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        headline = EXCLUDED.headline, bio = EXCLUDED.bio, discipline = EXCLUDED.discipline,
        skills = EXCLUDED.skills, hourly_rate_cents = EXCLUDED.hourly_rate_cents, currency = EXCLUDED.currency,
        visibility = EXCLUDED.visibility, availability = EXCLUDED.availability, published = EXCLUDED.published,
        location = EXCLUDED.location, timezone = EXCLUDED.timezone, updated_at = NOW()
    `;
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    return c.json({ ok: true });
  });

  // POST /me/resume — upload a resume file. Stored in R2 (native fallback) AND,
  // when hired.video is configured + linked, synced there so the parsed profile
  // + embedded viewer stay current.
  router.post('/me/resume', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const form = await c.req.formData();
    const entry = form.get('file');
    if (!entry || typeof entry === 'string') return c.json({ error: 'file is required' }, 400);
    const file = entry as unknown as File;
    if (file.size > RESUME_MAX_BYTES) return c.json({ error: 'File too large (max 10MB)' }, 413);
    const type = file.type || 'application/octet-stream';
    if (!RESUME_MIME.has(type)) return c.json({ error: 'Unsupported file type' }, 415);

    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `resumes/${userId}/${crypto.randomUUID()}.${ext}`;
    if (c.env.UPLOADS) {
      await c.env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: type } });
    }
    // Text-ish resumes can be forwarded to hired.video for parsing; binaries just
    // register the title (hired.video parses the claimed upload on their side).
    const rawText = type.startsWith('text/') ? (await file.text()).slice(0, 100_000) : undefined;

    const [row] = await sql(c.env)`SELECT hired_video_user_id, skills FROM freelancer_profiles WHERE user_id = ${userId}`;
    let resumeId: string | undefined;
    const hiredId = await resolveHiredUserId(c.env, userId, row?.hired_video_user_id as string | undefined);
    if (hiredId) {
      // Text résumés parse on hired.video; binaries are R2-only (uploadResume skips
      // them — hired.video rejects binary — and the worker parses/claims on their side).
      const res = await hiredUploadResume(c.env, hiredId, { title: file.name, rawText });
      resumeId = res.resumeId;
      // Refresh the cached extract, and PREFILL skills when the worker has none yet.
      const prof = await hiredGetProfile(c.env, hiredId);
      if (prof.extract) {
        const hasSkills = parseSkills(row?.skills).length > 0;
        const prefill = !hasSkills && prof.extract.skills.length > 0 ? JSON.stringify(prof.extract.skills.slice(0, 50)) : null;
        await sql(c.env)`
          UPDATE freelancer_profiles
          SET resume_extract = ${JSON.stringify(prof.extract.raw)},
              skills = COALESCE(${prefill}, skills), updated_at = NOW()
          WHERE user_id = ${userId}
        `;
        if (prefill) await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
      }
    }
    await sql(c.env)`
      UPDATE freelancer_profiles
      SET resume_key = ${key}, resume_filename = ${file.name}, hired_video_resume_id = COALESCE(${resumeId ?? null}, hired_video_resume_id), updated_at = NOW()
      WHERE user_id = ${userId}
    `;
    return c.json({ ok: true, resumeFilename: file.name });
  });

  // GET /me/embed-token — mint a short-lived hired.video embed URL for the
  // signed-in freelancer's own profile/resume viewer.
  router.get('/me/embed-token', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.query('kind') === 'resume' ? 'resume' : 'profile';
    const [row] = await sql(c.env)`SELECT hired_video_user_id FROM freelancer_profiles WHERE user_id = ${userId}`;
    const hiredId = await resolveHiredUserId(c.env, userId, row?.hired_video_user_id as string | undefined);
    if (!hiredId) return c.json({ configured: false, embedUrl: null });
    const res = await hiredCreateEmbedToken(c.env, hiredId, kind);
    return c.json({ configured: res.configured, embedUrl: res.embedUrl ?? null, expiresAt: res.expiresAt ?? null });
  });

  // POST /me/connect — start the consent flow to link an EXISTING hired.video
  // account (instead of the auto-provisioned one).
  router.post('/me/connect', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ email?: string; redirectUrl?: string }>();
    const [u] = await sql(c.env)`SELECT email FROM users WHERE id = ${userId}`;
    const email = (b.email || (u?.email as string) || '').trim();
    if (!email) return c.json({ error: 'email required' }, 400);
    const res = await hiredConnectExisting(c.env, { email, externalUserId: userId, redirectUrl: b.redirectUrl });
    return c.json({ configured: res.configured, consentUrl: res.consentUrl ?? null });
  });

  // --------------------------------------------------------------- PUBLIC -----

  // GET / — browse the marketplace with search/filter/pagination. Public profiles
  // are world-readable; private ones only surface for a signed-in viewer. The
  // all-public slice is CACHED under one key and filtered in memory, so search
  // never explodes the cache keyspace. Review aggregate (rating) is joined in.
  router.get('/', async (c) => {
    const viewer = await optionalUserId(c);
    const q = c.req.query();
    const filters = {
      q: q.q, discipline: q.discipline, skill: q.skill,
      minRate: q.minRate ? Number(q.minRate) : undefined,
      maxRate: q.maxRate ? Number(q.maxRate) : undefined,
      sort: q.sort, page: Math.max(1, Number(q.page) || 1), pageSize: Math.min(48, Math.max(1, Number(q.pageSize) || 24)),
    };
    const publicRows = await getOrSetCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY, () =>
      sql(c.env)`
        SELECT p.*, u.display_name, u.avatar_url,
          (SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id) AS avg_rating,
          (SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id)::int AS rating_count
        FROM freelancer_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.published = true AND p.visibility = 'public'
        ORDER BY p.updated_at DESC LIMIT 200
      ` as unknown as Promise<Record<string, unknown>[]>,
    );
    let rows = publicRows;
    if (viewer) {
      const privateRows = await sql(c.env)`
        SELECT p.*, u.display_name, u.avatar_url,
          (SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id) AS avg_rating,
          (SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id)::int AS rating_count
        FROM freelancer_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.published = true AND p.visibility = 'private'
        ORDER BY p.updated_at DESC LIMIT 200
      ` as unknown as Record<string, unknown>[];
      rows = [...publicRows, ...privateRows];
    }
    const { items, total } = applyTalentFilters(rows, filters);
    return c.json({ items: items.map(mapPublicProfile), total, page: filters.page, pageSize: filters.pageSize });
  });

  // GET /:id — one freelancer's public detail (+ rating + recent reviews). Private
  // profiles require auth.
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const viewer = await optionalUserId(c);
    const [row] = await sql(c.env)`
      SELECT p.*, u.display_name, u.avatar_url,
        (SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id) AS avg_rating,
        (SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id)::int AS rating_count
      FROM freelancer_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ${id} AND p.published = true
    `;
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.visibility === 'private' && !viewer) {
      return c.json({ error: 'This profile is only visible to signed-in members', code: 'AUTH_REQUIRED' }, 401);
    }
    // Give an authed viewer a hired.video embed URL for the in-page resume viewer.
    let embedUrl: string | null = null;
    if (viewer && row.hired_video_user_id) {
      const res = await hiredCreateEmbedToken(c.env, row.hired_video_user_id as string, 'profile');
      embedUrl = res.embedUrl ?? null;
    }
    const reviews = await sql(c.env)`
      SELECT rv.rating, rv.comment, rv.created_at, ru.display_name AS reviewer_name
      FROM freelancer_reviews rv LEFT JOIN users ru ON ru.id = rv.reviewer_user_id
      WHERE rv.freelancer_user_id = ${id} ORDER BY rv.created_at DESC LIMIT 20
    ` as unknown as Record<string, unknown>[];
    return c.json({
      ...mapPublicProfile(row),
      embedUrl,
      reviews: reviews.map((r) => ({ rating: Number(r.rating), comment: r.comment ?? null, createdAt: r.created_at, reviewerName: r.reviewer_name ?? null })),
    });
  });

  return router;
}

/**
 * Engagement routes — /api/engagements/*.
 * Employer actions require the tenant JWT; a worker viewing their own
 * engagements uses the web JWT.
 */
export function createEngagementRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const sql = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

  const mapEngagement = (r: Record<string, unknown>) => ({
    id: r.id,
    tenantId: Number(r.tenant_id),
    tenantName: r.tenant_name ?? null,
    projectId: r.project_id == null ? null : Number(r.project_id),
    freelancerUserId: r.freelancer_user_id,
    freelancerName: r.freelancer_name ?? null,
    status: r.status,
    rateCents: r.rate_cents == null ? null : Number(r.rate_cents),
    currency: r.currency ?? 'USD',
    title: r.title ?? null,
    note: r.note ?? null,
    invitedAt: r.invited_at ?? null,
    hiredAt: r.hired_at ?? null,
    terminatedAt: r.terminated_at ?? null,
  });

  // GET /engagements — as EMPLOYER: this tenant's engagements. (Worker view is
  // GET /engagements/mine below.)
  router.get('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await sql(c.env)`
      SELECT e.*, u.display_name AS freelancer_name
      FROM freelancer_engagements e JOIN users u ON u.id = e.freelancer_user_id
      WHERE e.tenant_id = ${tenantId} AND e.terminated_at IS NULL
      ORDER BY e.invited_at DESC LIMIT 500
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapEngagement));
  });

  // GET /engagements/mine — as WORKER (web JWT): every tenant I'm engaged with.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const rows = await sql(c.env)`
      SELECT e.*, t.name AS tenant_name
      FROM freelancer_engagements e JOIN tenants t ON t.id = e.tenant_id
      WHERE e.freelancer_user_id = ${userId} AND e.terminated_at IS NULL
      ORDER BY e.invited_at DESC LIMIT 500
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapEngagement));
  });

  // POST /engagements — an employer HIRES / invites a freelancer (optionally onto
  // a project). status 'active' hires immediately; 'interviewing'/'invited' opens
  // an interview first. Idempotent-ish: reuses the active engagement if one exists.
  router.post('/', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<{ freelancerUserId?: string; projectId?: number; rateCents?: number; title?: string; note?: string; status?: string }>();
    if (!b.freelancerUserId) return c.json({ error: 'freelancerUserId required' }, 400);
    // Must be a real, published freelancer.
    const [prof] = await sql(c.env)`
      SELECT p.user_id, p.hourly_rate_cents, p.currency FROM freelancer_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ${b.freelancerUserId} AND u.account_type = 'freelancer'
    `;
    if (!prof) return c.json({ error: 'Freelancer not found' }, 404);
    const status = ['invited', 'interviewing', 'active'].includes(b.status ?? '') ? (b.status as string) : 'invited';
    const rate = typeof b.rateCents === 'number' ? Math.round(b.rateCents) : (prof.hourly_rate_cents as number | null);
    const projectId = typeof b.projectId === 'number' ? b.projectId : null;

    const [existing] = await sql(c.env)`
      SELECT id FROM freelancer_engagements
      WHERE tenant_id = ${tenantId} AND freelancer_user_id = ${b.freelancerUserId}
        AND COALESCE(project_id, 0) = COALESCE(${projectId}, 0) AND terminated_at IS NULL
    `;
    const [ten] = await sql(c.env)`SELECT name FROM tenants WHERE id = ${tenantId}`;
    const tenantName = (ten?.name as string) ?? 'A workspace';
    const notifyKind = status === 'active' ? 'hired' : status === 'interviewing' ? 'interview' : 'invite';
    if (existing) {
      await sql(c.env)`
        UPDATE freelancer_engagements SET status = ${status}, updated_at = NOW(),
          hired_at = CASE WHEN ${status} = 'active' AND hired_at IS NULL THEN NOW() ELSE hired_at END
        WHERE id = ${existing.id}
      `;
      await notify(sql(c.env), c.env, { userId: b.freelancerUserId, tenantId, kind: notifyKind, title: `${tenantName} updated your engagement`, body: b.note ?? null, ref: existing.id as string });
      return c.json({ id: existing.id, status, reused: true });
    }
    const id = crypto.randomUUID();
    await sql(c.env)`
      INSERT INTO freelancer_engagements (id, tenant_id, project_id, freelancer_user_id, status, rate_cents, currency, title, note, created_by_user_id, hired_at)
      VALUES (${id}, ${tenantId}, ${projectId}, ${b.freelancerUserId}, ${status}, ${rate}, ${prof.currency ?? 'USD'}, ${b.title ?? null}, ${b.note ?? null}, ${actor}, ${status === 'active' ? new Date().toISOString() : null})
    `;
    await notify(sql(c.env), c.env, { userId: b.freelancerUserId, tenantId, kind: notifyKind, title: status === 'active' ? `${tenantName} hired you` : `${tenantName} wants to ${status === 'interviewing' ? 'interview' : 'engage'} you`, body: b.title ?? b.note ?? null, ref: id });
    return c.json({ id, status }, 201);
  });

  // PATCH /engagements/:id — move an engagement's status (interview → active, or
  // decline). Tenant-scoped so an employer can only touch its own engagements.
  router.patch('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string; rateCents?: number; title?: string }>();
    const status = ['invited', 'interviewing', 'active', 'declined'].includes(b.status ?? '') ? (b.status as string) : null;
    if (!status && b.rateCents == null && b.title == null) return c.json({ error: 'nothing to update' }, 400);
    const rows = await sql(c.env)`
      UPDATE freelancer_engagements SET
        status = COALESCE(${status}, status),
        rate_cents = COALESCE(${typeof b.rateCents === 'number' ? Math.round(b.rateCents) : null}, rate_cents),
        title = COALESCE(${b.title ?? null}, title),
        hired_at = CASE WHEN ${status} = 'active' AND hired_at IS NULL THEN NOW() ELSE hired_at END,
        updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND terminated_at IS NULL
      RETURNING id, status
    `;
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json({ id, status: updated.status });
  });

  // DELETE /engagements/:id — TERMINATE employment. Soft delete (terminated_at)
  // so hours/timecards keep their provenance; the engagement drops out of active
  // lists. Idempotent.
  router.delete('/:id', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    let reason: string | null = null;
    try { const b = await c.req.json<{ reason?: string }>(); reason = b.reason ?? null; } catch { /* body optional */ }
    const rows = await sql(c.env)`
      UPDATE freelancer_engagements SET terminated_at = NOW(), terminated_reason = ${reason}, status = 'terminated', updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND terminated_at IS NULL
      RETURNING freelancer_user_id
    `;
    if (rows[0]) {
      const [ten] = await sql(c.env)`SELECT name FROM tenants WHERE id = ${tenantId}`;
      await notify(sql(c.env), c.env, { userId: rows[0].freelancer_user_id as string, tenantId, kind: 'terminated', title: `${(ten?.name as string) ?? 'A workspace'} ended your engagement`, body: reason, ref: id });
    }
    return c.json({ ok: true });
  });

  // POST /:id/respond — WORKER (web JWT) accepts or declines an invite/interview.
  // Accept → 'active' (sets hired_at); decline → 'declined'. Only the engaged
  // freelancer may respond; notifies the employer who created it.
  router.post('/:id/respond', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ accept?: boolean }>();
    const target = b.accept ? 'active' : 'declined';
    const rows = await sql(c.env)`
      UPDATE freelancer_engagements SET status = ${target},
        hired_at = CASE WHEN ${target} = 'active' AND hired_at IS NULL THEN NOW() ELSE hired_at END,
        updated_at = NOW()
      WHERE id = ${id} AND freelancer_user_id = ${userId} AND terminated_at IS NULL
        AND status IN ('invited', 'interviewing')
      RETURNING tenant_id, created_by_user_id
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'Not found or not pending' }, 404);
    const [me] = await sql(c.env)`SELECT display_name FROM users WHERE id = ${userId}`;
    if (row.created_by_user_id) {
      await notify(sql(c.env), c.env, {
        userId: row.created_by_user_id as string, tenantId: Number(row.tenant_id),
        kind: b.accept ? 'accepted' : 'declined',
        title: `${(me?.display_name as string) ?? 'A freelancer'} ${b.accept ? 'accepted' : 'declined'} the engagement`, ref: id,
      });
    }
    return c.json({ ok: true, status: target });
  });

  // POST /:id/review — EMPLOYER (tenant JWT) rates the freelancer for this
  // engagement (1..5 + comment). One review per engagement; updates reputation.
  router.post('/:id/review', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ rating?: number; comment?: string }>();
    const rating = Math.max(1, Math.min(5, Math.round(Number(b.rating))));
    if (!Number.isFinite(rating)) return c.json({ error: 'rating 1..5 required' }, 400);
    const [eng] = await sql(c.env)`
      SELECT id, freelancer_user_id FROM freelancer_engagements WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);
    await sql(c.env)`
      INSERT INTO freelancer_reviews (id, engagement_id, tenant_id, freelancer_user_id, reviewer_user_id, rating, comment)
      VALUES (${crypto.randomUUID()}, ${id}, ${tenantId}, ${eng.freelancer_user_id}, ${actor}, ${rating}, ${b.comment ?? null})
      ON CONFLICT (engagement_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
    `;
    // Rating shows on the (cached) public list — invalidate it.
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    await notify(sql(c.env), c.env, { userId: eng.freelancer_user_id as string, tenantId, kind: 'review', title: `You received a ${rating}★ review`, body: b.comment ?? null, ref: id });
    return c.json({ ok: true, rating });
  });

  return router;
}
