import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
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
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  freelancerEngagements,
  freelancerProfiles,
  freelancerReviews,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

/** `freelancer_profiles.*` under the SNAKE_CASE keys every consumer below (and the
 *  cached browse payload) has always seen — the response shape is the contract. */
const profileColumns = {
  user_id: freelancerProfiles.userId,
  headline: freelancerProfiles.headline,
  bio: freelancerProfiles.bio,
  slug: freelancerProfiles.slug,
  avatar_key: freelancerProfiles.avatarKey,
  discipline: freelancerProfiles.discipline,
  skills: freelancerProfiles.skills,
  hourly_rate_cents: freelancerProfiles.hourlyRateCents,
  currency: freelancerProfiles.currency,
  visibility: freelancerProfiles.visibility,
  published: freelancerProfiles.published,
  availability: freelancerProfiles.availability,
  location: freelancerProfiles.location,
  timezone: freelancerProfiles.timezone,
  hired_video_user_id: freelancerProfiles.hiredVideoUserId,
  hired_video_connection_id: freelancerProfiles.hiredVideoConnectionId,
  hired_video_resume_id: freelancerProfiles.hiredVideoResumeId,
  hired_video_claim_url: freelancerProfiles.hiredVideoClaimUrl,
  resume_key: freelancerProfiles.resumeKey,
  resume_filename: freelancerProfiles.resumeFilename,
  resume_extract: freelancerProfiles.resumeExtract,
  created_at: freelancerProfiles.createdAt,
  updated_at: freelancerProfiles.updatedAt,
} as const;

/** Profile + the joined global user fields the talent card renders. */
const profileWithUserColumns = {
  ...profileColumns,
  display_name: users.displayName,
  avatar_url: users.avatarUrl,
} as const;

/** Review aggregate for a profile row. `direction`/`would_work_again` are real DB
 *  columns that the Drizzle `freelancerReviews` model does not declare yet, so the
 *  correlated aggregates stay as SQL fragments (still parameter-safe). */
const ratingColumns = {
  avg_rating: sql<string | null>`(SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews r WHERE r.freelancer_user_id = ${freelancerProfiles}.user_id AND r.direction = 'employer_to_freelancer')`,
  rating_count: sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = ${freelancerProfiles}.user_id AND r.direction = 'employer_to_freelancer')::int`,
} as const;

/** Extra reputation inputs the browse card's derived badge/JSS needs (list only). */
const reputationColumns = {
  again_count: sql<number>`(SELECT COUNT(*) FROM freelancer_reviews r WHERE r.freelancer_user_id = ${freelancerProfiles}.user_id AND r.direction = 'employer_to_freelancer' AND r.would_work_again = true)::int`,
  distinct_clients: sql<number>`(SELECT COUNT(DISTINCT e.tenant_id) FROM freelancer_engagements e WHERE e.freelancer_user_id = ${freelancerProfiles}.user_id AND e.hired_at IS NOT NULL)::int`,
  repeat_clients: sql<number>`(SELECT COUNT(*) FROM (SELECT e.tenant_id FROM freelancer_engagements e WHERE e.freelancer_user_id = ${freelancerProfiles}.user_id AND e.hired_at IS NOT NULL GROUP BY e.tenant_id HAVING COUNT(*) > 1) x)::int`,
  awarded: sql<number>`(SELECT COUNT(*) FROM freelancer_engagements e WHERE e.freelancer_user_id = ${freelancerProfiles}.user_id AND e.hired_at IS NOT NULL)::int`,
  activity_signals: sql<number>`(SELECT COUNT(*) FROM activity_signals s WHERE s.user_id = ${freelancerProfiles}.user_id AND s.occurred_at >= now() - interval '90 days')::int`,
  earned_cents: sql<string>`(SELECT COALESCE(SUM(amount_cents), 0) FROM freelancer_invoices i WHERE i.freelancer_user_id = ${freelancerProfiles}.user_id AND i.status = 'paid')::bigint`,
} as const;

/** `freelancer_engagements.*` under the snake_case keys `mapEngagement` reads. */
const engagementColumns = {
  id: freelancerEngagements.id,
  tenant_id: freelancerEngagements.tenantId,
  project_id: freelancerEngagements.projectId,
  freelancer_user_id: freelancerEngagements.freelancerUserId,
  status: freelancerEngagements.status,
  access_scope: freelancerEngagements.accessScope,
  rate_cents: freelancerEngagements.rateCents,
  currency: freelancerEngagements.currency,
  title: freelancerEngagements.title,
  note: freelancerEngagements.note,
  created_by_user_id: freelancerEngagements.createdByUserId,
  invited_at: freelancerEngagements.invitedAt,
  hired_at: freelancerEngagements.hiredAt,
  terminated_at: freelancerEngagements.terminatedAt,
  terminated_reason: freelancerEngagements.terminatedReason,
  created_at: freelancerEngagements.createdAt,
  updated_at: freelancerEngagements.updatedAt,
} as const;

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
  // Reputation (two-way reviews / JSS / badges — 0299):
  avgReceivedRating: number | null; // AVG of employer→freelancer ratings, or null
  reviewCount: number;              // number of received reviews
  jss: number | null;               // Job Success Score 0..100, null until 2+ reviews
  badge: 'top_rated' | 'rising_talent' | null; // derived trust badge
}

/** Derive a Job Success Score (0..100) + trust badge from the freelancer's received
 *  reviews, re-hire signals and client loyalty. Explainable blend: rating dominates,
 *  with an explicit "would work again" signal and repeat-client loyalty. Returns a
 *  null JSS until there are 2+ reviews (not enough signal to score honestly). */
export function deriveReputation(input: {
  avgRating: number | null; reviewCount: number; againCount: number;
  distinctClients: number; repeatClients: number; projectsAwarded: number; activitySignals: number; earnedCents: number;
}): { jss: number | null; badge: 'top_rated' | 'rising_talent' | null } {
  let jss: number | null = null;
  if (input.reviewCount >= 2 && input.avgRating != null) {
    const ratingC = input.avgRating / 5;
    const againC = input.reviewCount > 0 ? input.againCount / input.reviewCount : 0;
    const repeatC = input.distinctClients > 0 ? input.repeatClients / input.distinctClients : 0;
    jss = Math.round(100 * (0.65 * ratingC + 0.20 * againC + 0.15 * repeatC));
  }
  let badge: 'top_rated' | 'rising_talent' | null = null;
  if (jss != null && jss >= 90 && input.reviewCount >= 3 && input.earnedCents > 0) badge = 'top_rated';
  else if ((jss != null && jss >= 80 && input.reviewCount >= 1) || (input.reviewCount < 2 && input.projectsAwarded >= 1 && input.activitySignals >= 20)) badge = 'rising_talent';
  return { jss, badge };
}

/** Compute (and cache) a freelancer's stat block in ONE DB round-trip. Shared by the
 *  owner's own profile (GET /me) and the public detail (GET /:id) so both render the
 *  identical numbers. `fallbackCurrency` is used when the worker has no paid invoice yet. */
async function computeFreelancerStats(db: Db, env: HonoEnv['Bindings'], userId: string, fallbackCurrency: string): Promise<FreelancerStats> {
  return getOrSetCached(env as Env, freelancerStatsCacheKey(userId), async () => {
    // Fourteen correlated scalar aggregates in ONE round-trip — expressible only as
    // raw SQL, so this rides the Drizzle escape hatch (params still bound, never
    // concatenated). It also reads freelancer_reviews.direction/would_work_again,
    // which the Drizzle model does not declare.
    const [r] = (await db.execute(sql`
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
             AND (s.source IN ('vscode', 'agent') OR s.kind IN ('agent_run', 'agent_message', 'tool_exec')))::int AS ai_actions,
        -- Reputation inputs (received reviews only — direction-scoped so the reverse
        -- freelancer→employer rows never inflate the freelancer's own score).
        (SELECT ROUND(AVG(rating)::numeric, 2) FROM freelancer_reviews rv
           WHERE rv.freelancer_user_id = ${userId} AND rv.direction = 'employer_to_freelancer') AS avg_rating,
        (SELECT COUNT(*) FROM freelancer_reviews rv
           WHERE rv.freelancer_user_id = ${userId} AND rv.direction = 'employer_to_freelancer')::int AS review_count,
        (SELECT COUNT(*) FROM freelancer_reviews rv
           WHERE rv.freelancer_user_id = ${userId} AND rv.direction = 'employer_to_freelancer' AND rv.would_work_again = true)::int AS again_count,
        (SELECT COUNT(DISTINCT e.tenant_id) FROM freelancer_engagements e
           WHERE e.freelancer_user_id = ${userId} AND e.hired_at IS NOT NULL)::int AS distinct_clients,
        (SELECT COUNT(*) FROM (SELECT e.tenant_id FROM freelancer_engagements e
           WHERE e.freelancer_user_id = ${userId} AND e.hired_at IS NOT NULL GROUP BY e.tenant_id HAVING COUNT(*) > 1) x)::int AS repeat_clients
    `)).rows as Record<string, unknown>[];
    const avgRating = r?.avg_rating == null ? null : Number(r.avg_rating);
    const earnedCents = Number(r?.earned_cents ?? 0);
    const { jss, badge } = deriveReputation({
      avgRating, reviewCount: Number(r?.review_count ?? 0), againCount: Number(r?.again_count ?? 0),
      distinctClients: Number(r?.distinct_clients ?? 0), repeatClients: Number(r?.repeat_clients ?? 0),
      projectsAwarded: Number(r?.awarded ?? 0), activitySignals: Number(r?.activity_signals ?? 0), earnedCents,
    });
    return {
      aiActions: Number(r?.ai_actions ?? 0),
      activitySignals: Number(r?.activity_signals ?? 0),
      activeDays: Number(r?.active_days ?? 0),
      projectsAwarded: Number(r?.awarded ?? 0),
      activeEngagements: Number(r?.active_eng ?? 0),
      proposalsActive: Number(r?.proposals_active ?? 0),
      earnedToDateCents: earnedCents,
      currency: (r?.earned_currency as string) ?? fallbackCurrency,
      avgReceivedRating: avgRating,
      reviewCount: Number(r?.review_count ?? 0),
      jss,
      badge,
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
    // Trust badge/JSS for the browse card — derived from the row's reputation inputs
    // when the list query supplied them (the SAME deriveReputation the detail uses, so
    // the badge never disagrees across surfaces). Absent on rows without the inputs.
    ...(row.again_count === undefined ? {} : (() => {
      const { jss, badge } = deriveReputation({
        avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
        reviewCount: Number(row.rating_count ?? 0), againCount: Number(row.again_count ?? 0),
        distinctClients: Number(row.distinct_clients ?? 0), repeatClients: Number(row.repeat_clients ?? 0),
        projectsAwarded: Number(row.awarded ?? 0), activitySignals: Number(row.activity_signals ?? 0), earnedCents: Number(row.earned_cents ?? 0),
      });
      return { jss, badge };
    })()),
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

  /** Resolve a freelancer's hired.video userId — from the stored value, else
   *  reconcile via getByExternalUserId and persist it (covers accounts that were
   *  provisioned before the partner key was configured). ONE place so the résumé,
   *  embed-token and profile paths share the linkage logic (DRY). */
  async function resolveHiredUserId(db: Db, env: HonoEnv['Bindings'], userId: string, known?: string | null): Promise<string | null> {
    if (known) return known;
    const ref = await hiredGetByExternalUserId(env, userId);
    if (ref.ref?.userId) {
      await db.update(freelancerProfiles).set({
        hiredVideoUserId: ref.ref.userId,
        hiredVideoConnectionId: sql`COALESCE(${ref.ref.connectionId ?? null}, ${freelancerProfiles.hiredVideoConnectionId})`,
        updatedAt: sql`NOW()`,
      }).where(eq(freelancerProfiles.userId, userId));
      return ref.ref.userId;
    }
    return null;
  }

  /** The owner's own profile row (profile + joined user fields + email). */
  const loadOwnProfile = (db: Db, userId: string) =>
    db.select({ ...profileWithUserColumns, email: users.email })
      .from(freelancerProfiles)
      .innerJoin(users, eq(users.id, freelancerProfiles.userId))
      .where(eq(freelancerProfiles.userId, userId));

  // ------------------------------------------------------------------ SELF ----
  // Registered before the public :id route so "me" isn't swallowed by it.

  // GET /me — the signed-in freelancer's own full profile (creates a stub row on
  // first read so the edit form always has something to bind to).
  router.get('/me', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const [row] = await loadOwnProfile(db, userId);
    if (!row) {
      await db.insert(freelancerProfiles).values({ userId }).onConflictDoNothing();
      const [fresh] = await loadOwnProfile(db, userId);
      if (!fresh) return c.json({ error: 'Profile unavailable' }, 500);
      const stats = await computeFreelancerStats(db, c.env, userId, (fresh.currency as string) ?? 'USD');
      return c.json({ ...mapPublicProfile(fresh), published: false, hiredVideoConnected: Boolean(fresh.hired_video_user_id), email: fresh.email, stats });
    }
    const stats = await computeFreelancerStats(db, c.env, userId, (row.currency as string) ?? 'USD');
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
    const db = buildDatabase(c.env);
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
        const [taken] = await db.select({ user_id: freelancerProfiles.userId })
          .from(freelancerProfiles)
          .where(and(sql`lower(${freelancerProfiles.slug}) = ${norm}`, ne(freelancerProfiles.userId, userId)));
        if (taken) return c.json({ error: 'That alias is already taken.', code: 'SLUG_TAKEN' }, 409);
        slug = norm;
      }
    }

    // Display name lives on the global users row (shown on the talent card).
    if (typeof b.displayName === 'string') {
      const name = b.displayName.trim().slice(0, 255) || null;
      await db.update(users).set({ displayName: name, updatedAt: sql`NOW()` }).where(eq(users.id, userId));
    }

    await db.insert(freelancerProfiles).values({
      userId, headline, bio, discipline, skills,
      hourlyRateCents: rate, currency, visibility, availability, published, location, timezone,
      updatedAt: sql`NOW()`,
    }).onConflictDoUpdate({
      target: freelancerProfiles.userId,
      set: {
        headline: sql`EXCLUDED.headline`, bio: sql`EXCLUDED.bio`, discipline: sql`EXCLUDED.discipline`,
        skills: sql`EXCLUDED.skills`, hourlyRateCents: sql`EXCLUDED.hourly_rate_cents`, currency: sql`EXCLUDED.currency`,
        visibility: sql`EXCLUDED.visibility`, availability: sql`EXCLUDED.availability`, published: sql`EXCLUDED.published`,
        location: sql`EXCLUDED.location`, timezone: sql`EXCLUDED.timezone`, updatedAt: sql`NOW()`,
      },
    });
    // Slug is only touched when the caller sends the field (undefined = leave as-is).
    if (slug !== undefined) {
      await db.update(freelancerProfiles).set({ slug, updatedAt: sql`NOW()` }).where(eq(freelancerProfiles.userId, userId));
    }
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    return c.json({ ok: true, slug: slug === undefined ? undefined : slug });
  });

  // GET /me/slug-check?slug= — is this alias available? Returns validity + suggestions
  // so the editor can guide the user to a free one before they save.
  router.get('/me/slug-check', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const raw = c.req.query('slug') ?? '';
    const norm = normalizeSlug(raw);
    if (!isValidSlug(norm)) {
      return c.json({ slug: norm, valid: false, available: false, reason: 'invalid', suggestions: [] as string[] });
    }
    const [taken] = await db.select({ user_id: freelancerProfiles.userId })
      .from(freelancerProfiles)
      .where(and(sql`lower(${freelancerProfiles.slug}) = ${norm}`, ne(freelancerProfiles.userId, userId)));
    if (!taken) return c.json({ slug: norm, valid: true, available: true, suggestions: [] as string[] });
    // Offer a few free variants.
    const candidates = [`${norm}-1`, `${norm}-2`, `${norm}-dev`, `${norm}-io`, `${norm}-${userId.slice(0, 4)}`].filter(isValidSlug);
    // No candidates → nothing to look up (the `= ANY('{}')` this replaces matched nothing).
    const rows = candidates.length === 0 ? [] : await db
      .select({ slug: sql<string>`lower(${freelancerProfiles.slug})` })
      .from(freelancerProfiles)
      .where(inArray(sql`lower(${freelancerProfiles.slug})`, candidates));
    const used = new Set(rows.map((r) => r.slug));
    const suggestions = candidates.filter((s) => !used.has(s)).slice(0, 3);
    return c.json({ slug: norm, valid: true, available: false, suggestions });
  });

  // POST /me/resume — upload a resume file. Stored in R2 (native fallback) AND,
  // when hired.video is configured + linked, synced there so the parsed profile
  // + embedded viewer stay current.
  router.post('/me/resume', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
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

    const selected = await db.select({
      hired_video_user_id: freelancerProfiles.hiredVideoUserId,
      skills: freelancerProfiles.skills,
      resume_extract: freelancerProfiles.resumeExtract,
    }).from(freelancerProfiles).where(eq(freelancerProfiles.userId, userId));
    const row = selected[0] as Record<string, unknown> | undefined;
    let resumeId: string | undefined;
    const hiredId = await resolveHiredUserId(db, c.env, userId, row?.hired_video_user_id as string | undefined);
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
        await db.update(freelancerProfiles).set({
          resumeExtract: JSON.stringify(prof.extract.raw),
          skills: sql`COALESCE(${prefill}, ${freelancerProfiles.skills})`,
          updatedAt: sql`NOW()`,
        }).where(eq(freelancerProfiles.userId, userId));
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
    await db.update(freelancerProfiles).set({
      resumeKey: key,
      resumeFilename: file.name,
      hiredVideoResumeId: sql`COALESCE(${resumeId ?? null}, ${freelancerProfiles.hiredVideoResumeId})`,
      resumeExtract: sql`COALESCE(${nativeExtract ? JSON.stringify(nativeExtract) : null}, ${freelancerProfiles.resumeExtract})`,
      updatedAt: sql`NOW()`,
    }).where(eq(freelancerProfiles.userId, userId));
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
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const [row] = await db.select({
      hired_video_user_id: freelancerProfiles.hiredVideoUserId,
      resume_extract: freelancerProfiles.resumeExtract,
    }).from(freelancerProfiles).where(eq(freelancerProfiles.userId, userId));
    const empty: ResumeSuggestions = { available: false, headline: null, summary: null, skills: [], discipline: null };

    const hiredId = await resolveHiredUserId(db, c.env, userId, row?.hired_video_user_id as string | undefined);
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
      } catch (error) { /* not our native shape */ 
        reportCaughtError(error, { source: "presentation/routes/freelancerRoutes.ts", operation: "createFreelancerRoutes" });
      }
    }
    return c.json(empty);
  });

  // POST /me/avatar — upload a profile picture. Stored in R2; the public serve URL
  // (GET /:id/avatar) is mirrored onto users.avatar_url so every talent surface that
  // joins users renders it. Freelancer profiles are public, so the served object is too.
  router.post('/me/avatar', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
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
    await db.insert(freelancerProfiles)
      .values({ userId, avatarKey: key, updatedAt: sql`NOW()` })
      .onConflictDoUpdate({
        target: freelancerProfiles.userId,
        set: { avatarKey: key, updatedAt: sql`NOW()` },
      });
    await db.update(users).set({ avatarUrl, updatedAt: sql`NOW()` }).where(eq(users.id, userId));
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    return c.json({ ok: true, avatarUrl });
  });

  // GET /me/embed-token — mint a short-lived hired.video embed URL for the
  // signed-in freelancer's own profile/resume viewer.
  router.get('/me/embed-token', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const kind = c.req.query('kind') === 'resume' ? 'resume' : 'profile';
    const [row] = await db.select({ hired_video_user_id: freelancerProfiles.hiredVideoUserId })
      .from(freelancerProfiles).where(eq(freelancerProfiles.userId, userId));
    const hiredId = await resolveHiredUserId(db, c.env, userId, row?.hired_video_user_id as string | undefined);
    if (!hiredId) return c.json({ configured: false, embedUrl: null });
    const res = await hiredCreateEmbedToken(c.env, hiredId, kind);
    return c.json({ configured: res.configured, embedUrl: res.embedUrl ?? null, expiresAt: res.expiresAt ?? null });
  });

  // POST /me/connect — start the consent flow to link an EXISTING hired.video
  // account (instead of the auto-provisioned one).
  router.post('/me/connect', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ email?: string; redirectUrl?: string }>();
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
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
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ available?: boolean }>().catch(() => ({} as { available?: boolean }));
    const available = b.available === true;

    await db.update(users).set({ availableForHire: available, updatedAt: sql`NOW()` }).where(eq(users.id, userId));
    if (available) {
      const [u] = await db.select({ email: users.email, display_name: users.displayName })
        .from(users).where(eq(users.id, userId));
      if (u?.email) {
        await provisionForHireProfile(c.env as Env, { id: userId, email: u.email as string, name: (u.display_name as string) ?? null });
      }
    } else {
      // Hide them from browse + hire without discarding the profile they built.
      await db.update(freelancerProfiles).set({ published: false, updatedAt: sql`NOW()` })
        .where(eq(freelancerProfiles.userId, userId));
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
    const db = buildDatabase(c.env);
    const viewer = await optionalUserId(c);
    const q = c.req.query();
    const filters = {
      q: q.q, discipline: q.discipline, skill: q.skill,
      minRate: q.minRate ? Number(q.minRate) : undefined,
      maxRate: q.maxRate ? Number(q.maxRate) : undefined,
      sort: q.sort, page: Math.max(1, Number(q.page) || 1), pageSize: Math.min(48, Math.max(1, Number(q.pageSize) || 24)),
    };
    // One projection, two visibility slices — the reputation inputs run once per row
    // (per cache fill for the public slice), exactly as the two hand-written queries did.
    const browse = (visibility: 'public' | 'private') =>
      db.select({ ...profileWithUserColumns, ...ratingColumns, ...reputationColumns })
        .from(freelancerProfiles)
        .innerJoin(users, eq(users.id, freelancerProfiles.userId))
        .where(and(eq(freelancerProfiles.published, true), eq(freelancerProfiles.visibility, visibility)))
        .orderBy(desc(freelancerProfiles.updatedAt))
        .limit(200) as unknown as Promise<Record<string, unknown>[]>;

    const publicRows = await getOrSetCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY, () => browse('public'));
    let rows = publicRows;
    if (viewer) {
      const privateRows = await browse('private');
      rows = [...publicRows, ...privateRows];
    }
    const { items, total } = applyTalentFilters(rows, filters);
    return c.json({ items: items.map(mapPublicProfile), total, page: filters.page, pageSize: filters.pageSize });
  });

  // GET /:id/avatar — serve a freelancer's uploaded profile picture from R2. Public
  // (profiles are public), so the talent card / detail / marketplace <img> all resolve
  // without a token. Registered before /:id so it isn't swallowed by it.
  router.get('/:id/avatar', async (c) => {
    const db = buildDatabase(c.env);
    const id = c.req.param('id');
    if (!c.env.UPLOADS) return c.json({ error: 'Not found' }, 404);
    const [row] = await db.select({ avatar_key: freelancerProfiles.avatarKey })
      .from(freelancerProfiles)
      .where(or(eq(freelancerProfiles.userId, id), sql`lower(${freelancerProfiles.slug}) = ${id.toLowerCase()}`));
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
    const db = buildDatabase(c.env);
    const id = c.req.param('id');
    const viewer = await optionalUserId(c);
    const [row] = await db.select({ ...profileWithUserColumns, ...ratingColumns })
      .from(freelancerProfiles)
      .innerJoin(users, eq(users.id, freelancerProfiles.userId))
      .where(and(
        or(eq(freelancerProfiles.userId, id), sql`lower(${freelancerProfiles.slug}) = ${id.toLowerCase()}`),
        eq(freelancerProfiles.published, true),
      ));
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
    const reviews = await db.select({
      rating: freelancerReviews.rating,
      comment: freelancerReviews.comment,
      created_at: freelancerReviews.createdAt,
      reviewer_name: users.displayName,
    }).from(freelancerReviews)
      .leftJoin(users, eq(users.id, freelancerReviews.reviewerUserId))
      // `direction` is a real column the Drizzle model does not declare yet.
      .where(and(eq(freelancerReviews.freelancerUserId, uid), sql`freelancer_reviews.direction = 'employer_to_freelancer'`))
      .orderBy(desc(freelancerReviews.createdAt))
      .limit(20);
    const stats = await computeFreelancerStats(db, c.env, uid, (row.currency as string) ?? 'USD');
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
export function createEngagementRoutes(_db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

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
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const rows = await db.select({ ...engagementColumns, freelancer_name: users.displayName })
      .from(freelancerEngagements)
      .innerJoin(users, eq(users.id, freelancerEngagements.freelancerUserId))
      .where(and(eq(freelancerEngagements.tenantId, tenantId), isNull(freelancerEngagements.terminatedAt)))
      .orderBy(desc(freelancerEngagements.invitedAt))
      .limit(500);
    return c.json(rows.map(mapEngagement));
  });

  // GET /engagements/mine — as WORKER (web JWT): every tenant I'm engaged with.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const rows = await db.select({ ...engagementColumns, tenant_name: tenants.name })
      .from(freelancerEngagements)
      .innerJoin(tenants, eq(tenants.id, freelancerEngagements.tenantId))
      .where(and(eq(freelancerEngagements.freelancerUserId, userId), isNull(freelancerEngagements.terminatedAt)))
      .orderBy(desc(freelancerEngagements.invitedAt))
      .limit(500);
    return c.json(rows.map(mapEngagement));
  });

  // POST /engagements — an employer HIRES / invites a freelancer (optionally onto
  // a project). status 'active' hires immediately; 'interviewing'/'invited' opens
  // an interview first. Idempotent-ish: reuses the active engagement if one exists.
  router.post('/', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const b = await c.req.json<{ freelancerUserId?: string; projectId?: number; rateCents?: number; title?: string; note?: string; status?: string }>();
    if (!b.freelancerUserId) return c.json({ error: 'freelancerUserId required' }, 400);
    // Must be a PUBLISHED for-hire profile — the same gate the marketplace browse
    // uses. This covers both dedicated 'freelancer' accounts AND standard builders
    // who opted in to being hired (available_for_hire), so hiring never checks the
    // account type directly.
    const [prof] = await db.select({
      user_id: freelancerProfiles.userId,
      hourly_rate_cents: freelancerProfiles.hourlyRateCents,
      currency: freelancerProfiles.currency,
    }).from(freelancerProfiles)
      .innerJoin(users, eq(users.id, freelancerProfiles.userId))
      .where(and(eq(freelancerProfiles.userId, b.freelancerUserId), eq(freelancerProfiles.published, true)));
    if (!prof) return c.json({ error: 'Freelancer not found' }, 404);
    const status = ['invited', 'interviewing', 'active'].includes(b.status ?? '') ? (b.status as string) : 'invited';
    const rate = typeof b.rateCents === 'number' ? Math.round(b.rateCents) : (prof.hourly_rate_cents as number | null);
    const projectId = typeof b.projectId === 'number' ? b.projectId : null;

    const [existing] = await db.select({ id: freelancerEngagements.id })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.freelancerUserId, b.freelancerUserId),
        sql`COALESCE(${freelancerEngagements.projectId}, 0) = COALESCE(${projectId}, 0)`,
        isNull(freelancerEngagements.terminatedAt),
      ));
    const [ten] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    const tenantName = (ten?.name as string) ?? 'A workspace';
    const notifyKind = status === 'active' ? 'hired' : status === 'interviewing' ? 'interview' : 'invite';
    if (existing) {
      await db.update(freelancerEngagements).set({
        status,
        updatedAt: sql`NOW()`,
        hiredAt: sql`CASE WHEN ${status} = 'active' AND ${freelancerEngagements.hiredAt} IS NULL THEN NOW() ELSE ${freelancerEngagements.hiredAt} END`,
      }).where(eq(freelancerEngagements.id, existing.id));
      await notify(db, c.env, { userId: b.freelancerUserId, tenantId, kind: notifyKind, title: `${tenantName} updated your engagement`, body: b.note ?? null, ref: existing.id as string });
      await invalidateCached(c.env as Env, freelancerStatsCacheKey(b.freelancerUserId));
      return c.json({ id: existing.id, status, reused: true });
    }
    const id = crypto.randomUUID();
    await db.insert(freelancerEngagements).values({
      id,
      tenantId,
      projectId,
      freelancerUserId: b.freelancerUserId,
      status,
      rateCents: rate,
      currency: (prof.currency as string) ?? 'USD',
      title: b.title ?? null,
      note: b.note ?? null,
      createdByUserId: actor,
      hiredAt: status === 'active' ? new Date() : null,
    });
    await notify(db, c.env, { userId: b.freelancerUserId, tenantId, kind: notifyKind, title: status === 'active' ? `${tenantName} hired you` : `${tenantName} wants to ${status === 'interviewing' ? 'interview' : 'engage'} you`, body: b.title ?? b.note ?? null, ref: id });
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
    })().catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/freelancerRoutes.ts", operation: "createEngagementRoutes" });
    }));
    return c.json({ id, status }, 201);
  });

  // PATCH /engagements/:id — move an engagement's status (interview → active, or
  // decline). Tenant-scoped so an employer can only touch its own engagements.
  router.patch('/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string; rateCents?: number; title?: string }>();
    const status = ['invited', 'interviewing', 'active', 'declined'].includes(b.status ?? '') ? (b.status as string) : null;
    if (!status && b.rateCents == null && b.title == null) return c.json({ error: 'nothing to update' }, 400);
    const rows = await db.update(freelancerEngagements).set({
      status: sql`COALESCE(${status}, ${freelancerEngagements.status})`,
      rateCents: sql`COALESCE(${typeof b.rateCents === 'number' ? Math.round(b.rateCents) : null}, ${freelancerEngagements.rateCents})`,
      title: sql`COALESCE(${b.title ?? null}, ${freelancerEngagements.title})`,
      hiredAt: sql`CASE WHEN ${status} = 'active' AND ${freelancerEngagements.hiredAt} IS NULL THEN NOW() ELSE ${freelancerEngagements.hiredAt} END`,
      updatedAt: sql`NOW()`,
    }).where(and(
      eq(freelancerEngagements.id, id),
      eq(freelancerEngagements.tenantId, tenantId),
      isNull(freelancerEngagements.terminatedAt),
    )).returning({
      id: freelancerEngagements.id,
      status: freelancerEngagements.status,
      freelancer_user_id: freelancerEngagements.freelancerUserId,
    });
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(updated.freelancer_user_id as string));
    return c.json({ id, status: updated.status });
  });

  // DELETE /engagements/:id — TERMINATE employment. Soft delete (terminated_at)
  // so hours/timecards keep their provenance; the engagement drops out of active
  // lists. Idempotent.
  router.delete('/:id', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    let reason: string | null = null;
    try { const b = await c.req.json<{ reason?: string }>(); reason = b.reason ?? null; } catch (error) { /* body optional */ 
      reportCaughtError(error, { source: "presentation/routes/freelancerRoutes.ts", operation: "createEngagementRoutes" });
    }
    const rows = await db.update(freelancerEngagements).set({
      terminatedAt: sql`NOW()`,
      terminatedReason: reason,
      status: 'terminated',
      updatedAt: sql`NOW()`,
    }).where(and(
      eq(freelancerEngagements.id, id),
      eq(freelancerEngagements.tenantId, tenantId),
      isNull(freelancerEngagements.terminatedAt),
    )).returning({ freelancer_user_id: freelancerEngagements.freelancerUserId });
    if (rows[0]) {
      const [ten] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      await notify(db, c.env, { userId: rows[0].freelancer_user_id as string, tenantId, kind: 'terminated', title: `${(ten?.name as string) ?? 'A workspace'} ended your engagement`, body: reason, ref: id });
      await invalidateCached(c.env as Env, freelancerStatsCacheKey(rows[0].freelancer_user_id as string));
    }
    return c.json({ ok: true });
  });

  // POST /:id/respond — WORKER (web JWT) accepts or declines an invite/interview.
  // Accept → 'active' (sets hired_at); decline → 'declined'. Only the engaged
  // freelancer may respond; notifies the employer who created it.
  router.post('/:id/respond', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ accept?: boolean }>();
    const target = b.accept ? 'active' : 'declined';
    const rows = await db.update(freelancerEngagements).set({
      status: target,
      hiredAt: sql`CASE WHEN ${target} = 'active' AND ${freelancerEngagements.hiredAt} IS NULL THEN NOW() ELSE ${freelancerEngagements.hiredAt} END`,
      updatedAt: sql`NOW()`,
    }).where(and(
      eq(freelancerEngagements.id, id),
      eq(freelancerEngagements.freelancerUserId, userId),
      isNull(freelancerEngagements.terminatedAt),
      inArray(freelancerEngagements.status, ['invited', 'interviewing']),
    )).returning({
      tenant_id: freelancerEngagements.tenantId,
      created_by_user_id: freelancerEngagements.createdByUserId,
    });
    const row = rows[0];
    if (!row) return c.json({ error: 'Not found or not pending' }, 404);
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(userId));
    const [me] = await db.select({ display_name: users.displayName }).from(users).where(eq(users.id, userId));
    if (row.created_by_user_id) {
      await notify(db, c.env, {
        userId: row.created_by_user_id as string, tenantId: Number(row.tenant_id),
        kind: b.accept ? 'accepted' : 'declined',
        title: `${(me?.display_name as string) ?? 'A freelancer'} ${b.accept ? 'accepted' : 'declined'} the engagement`, ref: id,
      });
    }
    return c.json({ ok: true, status: target });
  });

  // POST /:id/review — EMPLOYER (tenant JWT) rates the freelancer for this engagement
  // (1..5 + comment + optional "would work again"). One review per engagement PER
  // DIRECTION; feeds the freelancer's rating + Job Success Score.
  router.post('/:id/review', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ rating?: number; comment?: string; wouldWorkAgain?: boolean }>();
    const rating = Math.max(1, Math.min(5, Math.round(Number(b.rating))));
    if (!Number.isFinite(rating)) return c.json({ error: 'rating 1..5 required' }, 400);
    const [eng] = await db.select({
      id: freelancerEngagements.id,
      freelancer_user_id: freelancerEngagements.freelancerUserId,
    }).from(freelancerEngagements)
      .where(and(eq(freelancerEngagements.id, id), eq(freelancerEngagements.tenantId, tenantId)));
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);
    const wouldWorkAgain = typeof b.wouldWorkAgain === 'boolean' ? b.wouldWorkAgain : null;
    await db.insert(freelancerReviews).values({
      id: crypto.randomUUID(), engagementId: id, tenantId,
      freelancerUserId: eng.freelancer_user_id as string, reviewerUserId: actor,
      rating, comment: b.comment ?? null, direction: 'employer_to_freelancer', wouldWorkAgain,
    }).onConflictDoUpdate({
      target: [freelancerReviews.engagementId, freelancerReviews.direction],
      set: { rating, comment: b.comment ?? null, wouldWorkAgain, updatedAt: new Date() },
    });
    // Rating + JSS show on the (cached) public list and the freelancer's stat block.
    await invalidateCached(c.env as Env, FREELANCER_PUBLIC_LIST_CACHE_KEY);
    await invalidateCached(c.env as Env, freelancerStatsCacheKey(eng.freelancer_user_id as string));
    await notify(db, c.env, { userId: eng.freelancer_user_id as string, tenantId, kind: 'review', title: `You received a ${rating}★ review`, body: b.comment ?? null, ref: id });
    return c.json({ ok: true, rating });
  });

  // POST /:id/review-client — FREELANCER (web JWT) rates the CLIENT for this
  // engagement (the reverse direction). Builds the client's two-way reputation shown
  // on job postings so other freelancers can vet who they bid with.
  router.post('/:id/review-client', webAuthMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const b = await c.req.json<{ rating?: number; comment?: string; wouldWorkAgain?: boolean }>();
    const rating = Math.max(1, Math.min(5, Math.round(Number(b.rating))));
    if (!Number.isFinite(rating)) return c.json({ error: 'rating 1..5 required' }, 400);
    const [eng] = await db.select({
      id: freelancerEngagements.id,
      tenant_id: freelancerEngagements.tenantId,
      created_by_user_id: freelancerEngagements.createdByUserId,
    }).from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.id, id),
        eq(freelancerEngagements.freelancerUserId, userId),
        isNotNull(freelancerEngagements.hiredAt),
      ));
    if (!eng) return c.json({ error: 'Engagement not found' }, 404);
    const wouldWorkAgain = typeof b.wouldWorkAgain === 'boolean' ? b.wouldWorkAgain : null;
    await db.insert(freelancerReviews).values({
      id: crypto.randomUUID(), engagementId: id, tenantId: Number(eng.tenant_id),
      freelancerUserId: userId, reviewerUserId: userId, rating,
      comment: b.comment ?? null, direction: 'freelancer_to_employer', wouldWorkAgain,
    }).onConflictDoUpdate({
      target: [freelancerReviews.engagementId, freelancerReviews.direction],
      set: { rating, comment: b.comment ?? null, wouldWorkAgain, updatedAt: new Date() },
    });
    // Client rating rides the (cached) open-jobs list — bust it so it reflects promptly.
    await invalidateCached(c.env as Env, 'jobs:public:open');
    if (eng.created_by_user_id) {
      await notify(db, c.env, { userId: eng.created_by_user_id as string, tenantId: Number(eng.tenant_id), kind: 'review', title: `A freelancer left you a ${rating}★ review`, body: b.comment ?? null, ref: id });
    }
    return c.json({ ok: true, rating });
  });

  return router;
}
