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
import { provisionForHireProfile } from '../../application/freelance/provisionForHire';
import { parseJsonArray } from '../../domain/shared/json';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

export const FREELANCER_PUBLIC_LIST_CACHE_KEY = 'fl:public:list';
const PUBLIC_LIST_TTL = 120;

/** Cache key for a freelancer's reputation stat block. Exported so the engagement /
 *  invoice writers invalidate the SAME key (one format, no drift). */
export function freelancerStatsCacheKey(userId: string): string {
  return `fl:stats:${userId}`;
}
// Stats are an aggregate over continuously-streaming activity signals, so they are
// TTL-bounded (not per-write invalidated) — a signal-level bust would fire on every
// heartbeat. The award/earnings/proposal counts ARE invalidated on their writes.
const STATS_TTL = 180;

/** The reputation numbers shown on a for-hire profile: how much the worker leans on
 *  AI, how active they've been, work won vs. in-flight bids, and lifetime earnings. */
export interface FreelancerStats {
  aiActions: number;         // AI/agent-driven signals (trailing 90d)
  activitySignals: number;   // all activity signals (trailing 90d)
  activeDays: number;        // distinct days with activity (trailing 90d)
  projectsAwarded: number;   // engagements ever hired (work won)
  activeEngagements: number; // engagements currently active
  proposalsActive: number;   // open bids (submitted | shortlisted)
  earnedToDateCents: number; // lifetime paid earnings
  currency: string;
}

/** Compute (and cache) a freelancer's stat block in ONE DB round-trip. Shared by the
 *  owner's own profile (GET /me) and the public detail (GET /:id) so both render the
 *  identical numbers. `fallbackCurrency` is used when the worker has no paid invoice yet. */
async function computeFreelancerStats(env: HonoEnv['Bindings'], userId: string, fallbackCurrency: string): Promise<FreelancerStats> {
  return getOrSetCached(env as Env, freelancerStatsCacheKey(userId), async () => {
    const sql = neon(env.NEON_DATABASE_URL);
    const [r] = await sql`
      SELECT
        (SELECT COUNT(*) FROM freelancer_engagements e
           WHERE e.freelancer_user_id = ${userId} AND e.hired_at IS NOT NULL)::int AS awarded,
        (SELECT COUNT(*) FROM freelancer_engagements e
           WHERE e.freelancer_user_id = ${userId} AND e.status = 'active' AND e.terminated_at IS NULL)::int AS active_eng,
        (SELECT COUNT(*) FROM job_proposals jp
           WHERE jp.freelancer_user_id = ${userId} AND jp.status IN ('submitted', 'shortlisted'))::int AS proposals_active,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM freelancer_invoices i
           WHERE i.freelancer_user_id = ${userId} AND i.status = 'paid')::bigint AS earned_cents,
        (SELECT i.currency FROM freelancer_invoices i
           WHERE i.freelancer_user_id = ${userId} AND i.status = 'paid'
           ORDER BY i.paid_at DESC NULLS LAST LIMIT 1) AS earned_currency,
        (SELECT COUNT(*) FROM activity_signals s
           WHERE s.user_id = ${userId} AND s.occurred_at >= now() - interval '90 days')::int AS activity_signals,
        (SELECT COUNT(DISTINCT date_trunc('day', s.occurred_at)) FROM activity_signals s
           WHERE s.user_id = ${userId} AND s.occurred_at >= now() - interval '90 days')::int AS active_days,
        (SELECT COUNT(*) FROM activity_signals s
           WHERE s.user_id = ${userId} AND s.occurred_at >= now() - interval '90 days'
             AND (s.source IN ('vscode', 'agent') OR s.kind IN ('agent_run', 'agent_message', 'tool_exec')))::int AS ai_actions
    `;
    return {
      aiActions: Number(r?.ai_actions ?? 0),
      activitySignals: Number(r?.activity_signals ?? 0),
      activeDays: Number(r?.active_days ?? 0),
      projectsAwarded: Number(r?.awarded ?? 0),
      activeEngagements: Number(r?.active_eng ?? 0),
      proposalsActive: Number(r?.proposals_active ?? 0),
      earnedToDateCents: Number(r?.earned_cents ?? 0),
      currency: (r?.earned_currency as string) ?? fallbackCurrency,
    };
  }, { kvTtlSeconds: STATS_TTL });
}

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

const AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

// Slugs a freelancer may NOT claim (collide with routes / reserved words).
const RESERVED_SLUGS = new Set([
  'me', 'admin', 'api', 'talent', 'freelancer', 'freelancers', 'new', 'edit',
  'settings', 'login', 'register', 'about', 'help', 'support', 'search', 'null', 'undefined',
]);

/** Parse the stored skills JSON column into a string[]. */
function parseSkills(raw: unknown): string[] {
  return parseJsonArray<string>(raw);
}

/** Normalize a candidate slug to the canonical form (lowercase, hyphen-joined). */
function normalizeSlug(raw: string): string {
  return raw.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alnum runs → single hyphen
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
    .slice(0, 40);
}

/** A slug is valid when it's 3–40 chars, lowercase alnum + interior hyphens, not reserved. */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Map skills/headline keywords → a discipline for résumé auto-fill. First hit wins. */
function inferDiscipline(text: string): string | null {
  const t = text.toLowerCase();
  const rules: [string, RegExp][] = [
    ['security', /\b(security|infosec|penetration|appsec|ciso|vulnerab)/],
    ['devops', /\b(devops|kubernetes|terraform|ci\/cd|sre|platform engineer)/],
    ['dba', /\b(dba|database administrat|postgres admin|oracle dba|sql server admin)/],
    ['data', /\b(data (engineer|scientist|analyst)|machine learning|\bml\b|analytics|etl)/],
    ['designer', /\b(designer|ux|ui\/ux|figma|product design|graphic)/],
    ['qa', /\b(qa|quality assurance|test engineer|sdet|automation test)/],
    ['pm', /\b(product manager|project manager|scrum master|program manager)/],
    ['developer', /\b(developer|engineer|full[- ]?stack|frontend|backend|software)/],
  ];
  for (const [discipline, re] of rules) if (re.test(t)) return discipline;
  return null;
}

/** Best-effort heuristic extraction of {headline, summary, skills} from résumé TEXT.
 *  The native fallback when hired.video isn't linked. Binary résumés (PDF/DOCX) have
 *  no local text and yield nothing — those rely on hired.video parsing instead. */
function parseResumeText(text: string): { headline: string | null; summary: string | null; skills: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  // Headline: first line that looks like a role (has a role keyword), else the 2nd
  // line (the 1st is usually the person's name).
  const roleRe = /(engineer|developer|designer|manager|architect|analyst|consultant|specialist|administrator|scientist|lead|director)/i;
  const headline = nonEmpty.find((l) => l.length <= 90 && roleRe.test(l)) ?? nonEmpty[1] ?? null;

  // Section scan: collect lines under a Skills / Summary heading.
  let section: 'skills' | 'summary' | null = null;
  const skillLines: string[] = [];
  const summaryLines: string[] = [];
  for (const raw of lines) {
    const l = raw.toLowerCase();
    if (/^(technical )?skills?\s*:?$/.test(l) || /^(core )?competenc/.test(l) || /^technolog/.test(l)) { section = 'skills'; continue; }
    if (/^(professional )?summary\s*:?$/.test(l) || /^(about|profile|objective)\s*:?$/.test(l)) { section = 'summary'; continue; }
    if (/^(experience|education|employment|projects|work history|certifications)\b/.test(l)) { section = null; continue; }
    if (!raw) { if (section === 'summary' && summaryLines.length) section = null; continue; }
    if (section === 'skills') skillLines.push(raw);
    else if (section === 'summary') summaryLines.push(raw);
  }

  // Split skill lines on common separators; also pick an inline "Skills: a, b, c".
  const inline = nonEmpty.find((l) => /^(technical )?skills?\s*:/i.test(l));
  const rawSkills = [...(inline ? [inline.replace(/^[^:]*:/, '')] : []), ...skillLines].join(',');
  const skills = Array.from(new Set(
    rawSkills.split(/[,•|/•\n]+/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 40),
  )).slice(0, 30);

  const summary = summaryLines.join(' ').slice(0, 1200) || null;
  return { headline: headline ? headline.slice(0, 200) : null, summary, skills };
}

/** Shape of a suggestion set the profile editor uses to prefill fields. */
interface ResumeSuggestions {
  available: boolean;
  headline: string | null;
  summary: string | null;
  skills: string[];
  discipline: string | null;
}

/** The PUBLIC projection — never leaks the R2 key or hired.video ids. */
function mapPublicProfile(row: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: row.user_id,
    slug: row.slug ?? null,
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
      const stats = await computeFreelancerStats(c.env, userId, (fresh.currency as string) ?? 'USD');
      return c.json({ ...mapPublicProfile(fresh), published: false, hiredVideoConnected: Boolean(fresh.hired_video_user_id), email: fresh.email, stats });
    }
    const stats = await computeFreelancerStats(c.env, userId, (row.currency as string) ?? 'USD');
    return c.json({
      ...mapPublicProfile(row),
      published: Boolean(row.published),
      hiredVideoConnected: Boolean(row.hired_video_user_id),
      hiredVideoClaimUrl: row.hired_video_claim_url ?? null,
      resumeFilename: row.resume_filename ?? null,
      // The résumé auto-fill button lights up when we have something to extract from:
      // a linked hired.video account or a cached native/hired extract.
      canAutofill: Boolean(row.hired_video_user_id) || Boolean(row.resume_extract),
      email: row.email,
      stats,
    });
  });

  // PATCH /me — update editable fields. Also owns the freelancer's display name
  // (users.display_name, since a freelancer is a global account) and vanity slug.
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

    // Slug: validate + enforce case-insensitive uniqueness. Empty string clears it.
    let slug: string | null | undefined;
    if (typeof b.slug === 'string') {
      const trimmed = b.slug.trim();
      if (trimmed === '') { slug = null; }
      else {
        const norm = normalizeSlug(trimmed);
        if (!isValidSlug(norm)) return c.json({ error: 'Invalid slug. Use 3–40 lowercase letters, numbers, or hyphens.', code: 'SLUG_INVALID' }, 400);
        const [taken] = await sql(c.env)`SELECT user_id FROM freelancer_profiles WHERE lower(slug) = ${norm} AND user_id <> ${userId}`;
        if (taken) return c.json({ error: 'That alias is already taken.', code: 'SLUG_TAKEN' }, 409);
        slug = norm;
      }
    }

    // Display name lives on the global users row (shown on the talent card).
    if (typeof b.displayName === 'string') {
      const name = b.displayName.trim().slice(0, 255) || null;
      await sql(c.env)`UPDATE users SET display_name = ${name}, updated_at = NOW() WHERE id = ${userId}`;
    }

    await sql(c.env)`
      INSERT INTO freelancer_profiles (user_id, headline, bio, discipline, skills, hourly_rate_cents, currency, visibility, availability, published, location, timezone, updated_at)
      VALUES (${userId}, ${headline}, ${bio}, ${discipline}, ${skills}, ${rate}, ${currency}, ${visibility}, ${availability}, ${published}, ${location}, ${timezone}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        headline = EXCLUDED.headline, bio = EXCLUDED.bio, discipline = EXCLUDED.discipline,
        skills = EXCLUDED.skills, hourly_rate_cents = EXCLUDED.hourly_rate_cents, currency = EXCLUDED.currency,
        visibility = EXCLUDED.visibility, availability = EXCLUDED.availability, published = EXCLUDED.published,
        location = EXCLUDED.location, timezone = EXCLUDED.timezone, updated_at = NOW()
    `;
    // Slug is only touched when the caller sends the field (undefined = leave as-is).
    if (slug !== undefined) {
      await sql(c.env)`UPDATE freelancer_profiles SET slug = ${slug}, updated_at = NOW() WHERE user_id = ${userId}`;
    }
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    return c.json({ ok: true, slug: slug === undefined ? undefined : slug });
  });

  // GET /me/slug-check?slug= — is this alias available? Returns validity + suggestions
  // so the editor can guide the user to a free one before they save.
  router.get('/me/slug-check', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const raw = c.req.query('slug') ?? '';
    const norm = normalizeSlug(raw);
    if (!isValidSlug(norm)) {
      return c.json({ slug: norm, valid: false, available: false, reason: 'invalid', suggestions: [] as string[] });
    }
    const [taken] = await sql(c.env)`SELECT user_id FROM freelancer_profiles WHERE lower(slug) = ${norm} AND user_id <> ${userId}`;
    if (!taken) return c.json({ slug: norm, valid: true, available: true, suggestions: [] as string[] });
    // Offer a few free variants.
    const candidates = [`${norm}-1`, `${norm}-2`, `${norm}-dev`, `${norm}-io`, `${norm}-${userId.slice(0, 4)}`].filter(isValidSlug);
    const rows = await sql(c.env)`
      SELECT lower(slug) AS slug FROM freelancer_profiles WHERE lower(slug) = ANY(${candidates})
    ` as unknown as Record<string, unknown>[];
    const used = new Set(rows.map((r) => r.slug));
    const suggestions = candidates.filter((s) => !used.has(s)).slice(0, 3);
    return c.json({ slug: norm, valid: true, available: false, suggestions });
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
    // Native fallback: when hired.video isn't linked but the résumé is text we can
    // read, parse a local extract so the "Fill from résumé" button still works.
    let nativeExtract: { native: true; headline: string | null; summary: string | null; skills: string[] } | null = null;
    if (!hiredId && rawText) {
      const parsed = parseResumeText(rawText);
      nativeExtract = { native: true, ...parsed };
    }
    await sql(c.env)`
      UPDATE freelancer_profiles
      SET resume_key = ${key}, resume_filename = ${file.name},
          hired_video_resume_id = COALESCE(${resumeId ?? null}, hired_video_resume_id),
          resume_extract = COALESCE(${nativeExtract ? JSON.stringify(nativeExtract) : null}, resume_extract),
          updated_at = NOW()
      WHERE user_id = ${userId}
    `;
    // Auto-fill is possible when we have a hired.video link OR any cached extract
    // (this upload's native parse, a prior hired parse, …). Binary résumés without
    // hired.video yield nothing locally — hired.video parses them on claim.
    const canAutofill = Boolean(hiredId) || Boolean(nativeExtract) || Boolean(row?.resume_extract);
    return c.json({ ok: true, resumeFilename: file.name, canAutofill });
  });

  // GET /me/resume/suggestions — extracted {headline, summary, skills, discipline}
  // the editor uses to prefill fields (from hired.video when linked, else the cached
  // native parse). Never writes — the user reviews + saves.
  router.get('/me/resume/suggestions', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const [row] = await sql(c.env)`SELECT hired_video_user_id, resume_extract FROM freelancer_profiles WHERE user_id = ${userId}`;
    const empty: ResumeSuggestions = { available: false, headline: null, summary: null, skills: [], discipline: null };

    const hiredId = await resolveHiredUserId(c.env, userId, row?.hired_video_user_id as string | undefined);
    if (hiredId) {
      const prof = await hiredGetProfile(c.env, hiredId);
      if (prof.extract) {
        const { headline, summary, skills } = prof.extract;
        return c.json({
          available: true, headline: headline ?? null, summary: summary ?? null, skills: skills ?? [],
          discipline: inferDiscipline(`${headline ?? ''} ${(skills ?? []).join(' ')}`),
        } satisfies ResumeSuggestions);
      }
    }
    // Native cached extract (from a text résumé upload).
    if (typeof row?.resume_extract === 'string') {
      try {
        const parsed = JSON.parse(row.resume_extract) as { native?: boolean; headline?: string | null; summary?: string | null; skills?: string[] };
        if (parsed.native) {
          const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
          return c.json({
            available: true, headline: parsed.headline ?? null, summary: parsed.summary ?? null, skills,
            discipline: inferDiscipline(`${parsed.headline ?? ''} ${skills.join(' ')}`),
          } satisfies ResumeSuggestions);
        }
      } catch { /* not our native shape */ }
    }
    return c.json(empty);
  });

  // POST /me/avatar — upload a profile picture. Stored in R2; the public serve URL
  // (GET /:id/avatar) is mirrored onto users.avatar_url so every talent surface that
  // joins users renders it. Freelancer profiles are public, so the served object is too.
  router.post('/me/avatar', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const form = await c.req.formData();
    const entry = form.get('file');
    if (!entry || typeof entry === 'string') return c.json({ error: 'file is required' }, 400);
    const file = entry as unknown as File;
    if (file.size > AVATAR_MAX_BYTES) return c.json({ error: 'Image too large (max 5MB)' }, 413);
    const type = file.type || 'application/octet-stream';
    if (!AVATAR_MIME.has(type)) return c.json({ error: 'Unsupported image type (PNG, JPEG, WebP, or GIF)' }, 415);
    if (!c.env.UPLOADS) return c.json({ error: 'Image storage not configured' }, 503);

    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
    const key = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;
    await c.env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: type } });

    // Absolute, cache-busted public URL → users.avatar_url (surfaced by the joins).
    const origin = new URL(c.req.url).origin;
    const avatarUrl = `${origin}/api/freelancers/${userId}/avatar?v=${Date.now()}`;
    await sql(c.env)`
      INSERT INTO freelancer_profiles (user_id, avatar_key, updated_at) VALUES (${userId}, ${key}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET avatar_key = ${key}, updated_at = NOW()
    `;
    await sql(c.env)`UPDATE users SET avatar_url = ${avatarUrl}, updated_at = NOW() WHERE id = ${userId}`;
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    return c.json({ ok: true, avatarUrl });
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

  // POST /me/availability { available } — an EXISTING builder opts IN or OUT of being
  // hired talent, WITHOUT changing their account type (they keep the full builder shell).
  //  - opt IN  → flag the user + provision the for-hire profile stub (idempotent). The
  //              profile starts private/unpublished; the profile editor publishes it.
  //  - opt OUT → clear the flag + UNPUBLISH the profile so they drop out of the talent
  //              marketplace and the hire gate (the profile row is kept, just hidden).
  router.post('/me/availability', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ available?: boolean }>().catch(() => ({} as { available?: boolean }));
    const available = b.available === true;

    await sql(c.env)`UPDATE users SET available_for_hire = ${available}, updated_at = NOW() WHERE id = ${userId}`;
    if (available) {
      const [u] = await sql(c.env)`SELECT email, display_name FROM users WHERE id = ${userId}`;
      if (u?.email) {
        await provisionForHireProfile(c.env as Env, { id: userId, email: u.email as string, name: (u.display_name as string) ?? null });
      }
    } else {
      // Hide them from browse + hire without discarding the profile they built.
      await sql(c.env)`UPDATE freelancer_profiles SET published = false, updated_at = NOW() WHERE user_id = ${userId}`;
      await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    }
    return c.json({ availableForHire: available });
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

  // GET /:id/avatar — serve a freelancer's uploaded profile picture from R2. Public
  // (profiles are public), so the talent card / detail / marketplace <img> all resolve
  // without a token. Registered before /:id so it isn't swallowed by it.
  router.get('/:id/avatar', async (c) => {
    const id = c.req.param('id');
    if (!c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
    const [row] = await sql(c.env)`SELECT avatar_key FROM freelancer_profiles WHERE user_id = ${id} OR lower(slug) = ${id.toLowerCase()}`;
    const key = row?.avatar_key as string | undefined;
    if (!key) return c.json({ error: 'Not found' }, 404);
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(obj.body, { headers });
  });

  // GET /:id — one freelancer's public detail (+ rating + recent reviews). `:id` is
  // EITHER the raw user guid OR the vanity slug. Private profiles require auth.
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const viewer = await optionalUserId(c);
    const [row] = await sql(c.env)`
      SELECT p.*, u.display_name, u.avatar_url,
        (SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id) AS avg_rating,
        (SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = p.user_id)::int AS rating_count
      FROM freelancer_profiles p JOIN users u ON u.id = p.user_id
      WHERE (p.user_id = ${id} OR lower(p.slug) = ${id.toLowerCase()}) AND p.published = true
    `;
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.visibility === 'private' && !viewer) {
      return c.json({ error: 'This profile is only visible to signed-in members', code: 'AUTH_REQUIRED' }, 401);
    }
    const uid = row.user_id as string;
    // Give an authed viewer a hired.video embed URL for the in-page resume viewer.
    let embedUrl: string | null = null;
    if (viewer && row.hired_video_user_id) {
      const res = await hiredCreateEmbedToken(c.env, row.hired_video_user_id as string, 'profile');
      embedUrl = res.embedUrl ?? null;
    }
    const reviews = await sql(c.env)`
      SELECT rv.rating, rv.comment, rv.created_at, ru.display_name AS reviewer_name
      FROM freelancer_reviews rv LEFT JOIN users ru ON ru.id = rv.reviewer_user_id
      WHERE rv.freelancer_user_id = ${uid} ORDER BY rv.created_at DESC LIMIT 20
    ` as unknown as Record<string, unknown>[];
    const stats = await computeFreelancerStats(c.env, uid, (row.currency as string) ?? 'USD');
    return c.json({
      ...mapPublicProfile(row),
      embedUrl,
      stats,
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
export function createEngagementRoutes(db: Db): Hono<HonoEnv> {
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
    // Must be a PUBLISHED for-hire profile — the same gate the marketplace browse
    // uses. This covers both dedicated 'freelancer' accounts AND standard builders
    // who opted in to being hired (available_for_hire), so hiring never checks the
    // account type directly.
    const [prof] = await sql(c.env)`
      SELECT p.user_id, p.hourly_rate_cents, p.currency FROM freelancer_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ${b.freelancerUserId} AND p.published = true
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
      await invalidateCached(c.env as Env, freelancerStatsCacheKey(b.freelancerUserId));
      return c.json({ id: existing.id, status, reused: true });
    }
    const id = crypto.randomUUID();
    await sql(c.env)`
      INSERT INTO freelancer_engagements (id, tenant_id, project_id, freelancer_user_id, status, rate_cents, currency, title, note, created_by_user_id, hired_at)
      VALUES (${id}, ${tenantId}, ${projectId}, ${b.freelancerUserId}, ${status}, ${rate}, ${prof.currency ?? 'USD'}, ${b.title ?? null}, ${b.note ?? null}, ${actor}, ${status === 'active' ? new Date().toISOString() : null})
    `;
    await notify(sql(c.env), c.env, { userId: b.freelancerUserId, tenantId, kind: notifyKind, title: status === 'active' ? `${tenantName} hired you` : `${tenantName} wants to ${status === 'interviewing' ? 'interview' : 'engage'} you`, body: b.title ?? b.note ?? null, ref: id });
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(b.freelancerUserId));

    // Unified audit stream: a hire / engagement decision, attributed to the
    // manager who made it. Target is the external talent + the new engagement.
    c.executionCtx.waitUntil((async () => {
      const actorIdentity = await resolveActorFromContext(c.env as Env, db, c);
      await recordActivity(c.env as Env, db, {
        tenantId,
        projectId,
        actor: actorIdentity,
        verb: status === 'active' ? 'member.hired' : 'engagement.created',
        targetType: 'engagement',
        targetId: id,
        targetLabel: b.title ?? 'Engagement',
        summary: status === 'active' ? `Hired external talent (${status})` : `Invited external talent (${status})`,
        metadata: { engagementId: id, freelancerUserId: b.freelancerUserId, status, projectId },
      });
    })().catch(() => {}));
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
      RETURNING id, status, freelancer_user_id
    `;
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(updated.freelancer_user_id as string));
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
      await invalidateCached(c.env as Env, freelancerStatsCacheKey(rows[0].freelancer_user_id as string));
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
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(userId));
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
