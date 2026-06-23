/**
 * Workforce member routes — /api/members
 *
 * Two concerns, one resource (the polymorphic workforce member, human OR agent,
 * keyed by :kind/:ref = team_member_kind + users.id|ide_agents.id|agent_hosts.id):
 *
 *  1. Capability & availability PROFILE (migration 0116) — the inputs the AI
 *     sprint planner needs to decide who/what/when. Read by the planner via
 *     GET /profiles (cached); edited via PUT /:kind/:ref/profile.
 *  2. Effectiveness / engagement METRICS + DORA (migrations 0117/0118) — derived
 *     read-through (cached, version-token invalidated on task/deploy writes).
 *     Manager-gated. POST /deployments feeds the DORA deploy stream.
 *
 * Profiles are authed (the workforce is shared); metrics + deployments are
 * MANAGER+.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { deploymentEvents, integrationCredentials, memberMetricsPeriod, memberProfiles, users } from '../../infrastructure/database/schema';
import { decryptCredentials } from '../../application/integrations/credentialCrypto';
import { syncMemberCalendar, type CalendarCredential } from '../../application/integrations/googleCalendarSync';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  computeDora,
  computeMemberMetrics,
  doraCacheKey,
  memberMetricsCacheKey,
  readWorkforceMetricsVersion,
  bumpWorkforceMetricsVersion,
  type MemberScorecard,
} from '../../application/metrics/workforceMetrics';
import { recommendAssignee } from '../../application/metrics/assigneeRecommender';
import { getTenantEngagement, persistTenantEngagement } from '../../application/metrics/engagement';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MEMBER_KINDS = new Set(['human', 'cloud_agent', 'host_agent']);
const clampDays = (raw: number, def: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : def));

function profilesCacheKey(tenantId: number): string { return `member-profiles:tenant:${tenantId}`; }

/** The profile fields a caller may set (server owns id/tenant/segment/timestamps). */
interface ProfileBody {
  timezone?: string | null;
  workHours?: unknown;
  pto?: unknown;
  responseSlaHours?: number | null;
  weeklyCapacityHours?: number | null;
  dailyCapacityPoints?: number | null;
  maxConcurrentWip?: number | null;
  rampFactor?: number | null;
  experienceLevel?: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | null;
  skills?: unknown;
  focusAreas?: unknown;
  preferredTaskTypes?: unknown;
  availabilityStatus?: 'available' | 'busy' | 'focus' | 'ooo' | 'on_call';
  availabilityUntil?: string | null;
  lastActiveAt?: string | null;
  costRateUsdCents?: number | null;
  syncSource?: 'manual' | 'google_calendar';
}

export function createMemberRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /api/members/profiles — every member profile for the tenant ────────
  // Planner consumption. Cached (profiles change rarely); invalidated on any
  // profile PUT below.
  router.get('/profiles', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const profiles = await getOrSetCached(c.env as Env, profilesCacheKey(tenantId), async () =>
      db.select().from(memberProfiles).where(eq(memberProfiles.tenantId, tenantId)),
    );
    return c.json({ profiles });
  });

  // ── GET /api/members/:kind/:ref/profile — one profile (null if unset) ──────
  router.get('/:kind/:ref/profile', async (c) => {
    const kind = c.req.param('kind');
    const ref = c.req.param('ref');
    if (!MEMBER_KINDS.has(kind)) return c.json({ error: 'invalid member kind' }, 400);
    const tenantId = c.get('tenantId') as number;
    const [row] = await db
      .select()
      .from(memberProfiles)
      .where(and(
        eq(memberProfiles.tenantId, tenantId),
        eq(memberProfiles.memberKind, kind as 'human' | 'cloud_agent' | 'host_agent'),
        eq(memberProfiles.memberRef, ref),
      ))
      .limit(1);
    return c.json({ profile: row ?? null });
  });

  // ── PUT /api/members/:kind/:ref/profile — upsert ───────────────────────────
  router.put('/:kind/:ref/profile', async (c) => {
    const kind = c.req.param('kind');
    const ref = c.req.param('ref');
    if (!MEMBER_KINDS.has(kind)) return c.json({ error: 'invalid member kind' }, 400);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<ProfileBody>();

    const values = {
      tenantId,
      memberKind: kind as 'human' | 'cloud_agent' | 'host_agent',
      memberRef: ref,
      timezone: body.timezone ?? null,
      workHours: body.workHours ?? null,
      pto: body.pto ?? null,
      responseSlaHours: body.responseSlaHours ?? null,
      weeklyCapacityHours: body.weeklyCapacityHours ?? null,
      dailyCapacityPoints: body.dailyCapacityPoints ?? null,
      maxConcurrentWip: body.maxConcurrentWip ?? null,
      rampFactor: body.rampFactor ?? 1.0,
      experienceLevel: body.experienceLevel ?? null,
      skills: body.skills ?? null,
      focusAreas: body.focusAreas ?? null,
      preferredTaskTypes: body.preferredTaskTypes ?? null,
      availabilityStatus: body.availabilityStatus ?? 'available',
      availabilityUntil: body.availabilityUntil ? new Date(body.availabilityUntil) : null,
      lastActiveAt: body.lastActiveAt ? new Date(body.lastActiveAt) : null,
      costRateUsdCents: body.costRateUsdCents ?? null,
      syncSource: body.syncSource ?? 'manual',
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(memberProfiles)
      .values(values)
      .onConflictDoUpdate({
        target: [memberProfiles.tenantId, memberProfiles.memberKind, memberProfiles.memberRef],
        set: { ...values },
      })
      .returning();

    await invalidateCached(c.env as Env, profilesCacheKey(tenantId)).catch(() => {});
    // A profile change (capacity / availability / skills) alters assignee
    // recommendations + scorecards, so bust the version-token caches too.
    await bumpWorkforceMetricsVersion(c.env as Env, tenantId).catch(() => {});
    return c.json({ profile: row });
  });

  // ── GET /api/members/recommend?projectId=&skills=a,b — ranked owners ────────
  // The planner-facing read: rank the project's workforce by capability /
  // availability / spare WIP / skill match so the assignee picker (and fan-out)
  // can pick an owner. Cached via the same version token (bumped on task status +
  // profile writes). Authed — it's an assignment aid, not a privileged report.
  router.get('/recommend', async (c) => {
    const projectId = Number(c.req.query('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'projectId is required' }, 400);
    const skills = (c.req.query('skills') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const recommendations = await recommendAssignee(c.env as Env, db, { projectId, requiredSkills: skills });
    return c.json({ recommendations });
  });

  // ── POST /api/members/:kind/:ref/calendar-sync — overlay Google Calendar ───
  // Pulls the member's Google Calendar (busy now + upcoming PTO) via the tenant's
  // connected `google_calendar` integration credential and writes it onto their
  // profile (sync_source='google_calendar'). Humans only — agents have no
  // calendar. No-op-with-message until a Google account is connected. MANAGER+.
  router.post('/:kind/:ref/calendar-sync', requireRole(TenantRole.MANAGER), async (c) => {
    const kind = c.req.param('kind');
    const ref = c.req.param('ref');
    if (kind !== 'human') return c.json({ error: 'calendar sync applies to human members only' }, 400);
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ calendarId?: string }>().catch(() => ({} as { calendarId?: string }));

    const credential = await resolveGoogleCalendarCredential(c.env as Env, db, tenantId);
    if (!credential) return c.json({ error: 'no enabled google_calendar integration connected for this workspace' }, 409);

    // Default the calendar id to the user's email (their primary calendar).
    let calendarId = body.calendarId;
    if (!calendarId) {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, ref)).limit(1);
      calendarId = u?.email;
    }
    if (!calendarId) return c.json({ error: 'could not resolve a calendar id for this member' }, 400);

    const result = await syncMemberCalendar(c.env as Env, db, { tenantId, memberRef: ref, calendarId, credential });
    if (result.ok) {
      await invalidateCached(c.env as Env, profilesCacheKey(tenantId)).catch(() => {});
      await bumpWorkforceMetricsVersion(c.env as Env, tenantId).catch(() => {});
    }
    return c.json(result, result.ok ? 200 : 502);
  });

  // ── GET /api/members/metrics?days=7 — all scorecards (MANAGER+) ────────────
  router.get('/metrics', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = clampDays(parseInt(c.req.query('days') ?? '7', 10), 7, 180);
    const env = c.env as Env;
    const version = await readWorkforceMetricsVersion(env, tenantId);
    const scorecards = await getOrSetCached(env, memberMetricsCacheKey(tenantId, version, days), () =>
      computeMemberMetrics(db, tenantId, days),
    );
    // Snapshot into member_metrics_period (best-effort) so the table is the
    // queryable history behind sprint retros, not just an on-the-fly read.
    c.executionCtx.waitUntil(snapshotMetrics(db, tenantId, days, scorecards).catch(() => {}));
    return c.json({ windowDays: days, members: scorecards });
  });

  // ── GET /api/members/:kind/:ref/metrics?days=7 — one member ────────────────
  router.get('/:kind/:ref/metrics', requireRole(TenantRole.MANAGER), async (c) => {
    const kind = c.req.param('kind');
    const ref = c.req.param('ref');
    if (!MEMBER_KINDS.has(kind)) return c.json({ error: 'invalid member kind' }, 400);
    const tenantId = c.get('tenantId') as number;
    const days = clampDays(parseInt(c.req.query('days') ?? '7', 10), 7, 180);
    const env = c.env as Env;
    const version = await readWorkforceMetricsVersion(env, tenantId);
    const all = await getOrSetCached(env, memberMetricsCacheKey(tenantId, version, days), () =>
      computeMemberMetrics(db, tenantId, days),
    );
    const one = all.find((m) => m.memberKind === kind && m.memberRef === ref) ?? null;
    return c.json({ windowDays: days, member: one });
  });

  // ── GET /api/members/dora?days=30 — DORA rollup (MANAGER+) ─────────────────
  router.get('/dora', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = clampDays(parseInt(c.req.query('days') ?? '30', 10), 30, 365);
    const env = c.env as Env;
    const version = await readWorkforceMetricsVersion(env, tenantId);
    const dora = await getOrSetCached(env, doraCacheKey(tenantId, version, days), () =>
      computeDora(db, tenantId, days),
    );
    return c.json(dora);
  });

  // ── GET /api/members/engagement?days=30 — unified engagement (MANAGER+) ────
  // Folds external dev activity + platform usage + VS Code presence + delivery
  // into one engagement score per human member (incl. the task-less). Cached.
  router.get('/engagement', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = clampDays(parseInt(c.req.query('days') ?? '30', 10), 30, 365);
    const members = await getTenantEngagement(c.env as Env, db, tenantId, days);
    // Snapshot into member_metrics_period (best-effort) so the composite score has
    // trend history, mirroring the scorecard snapshot on the members read.
    c.executionCtx.waitUntil(persistTenantEngagement(db, tenantId, days, members).catch(() => {}));
    return c.json({ windowDays: days, members });
  });

  // ── POST /api/members/deployments — record a deploy (DORA stream) ──────────
  // Frequency / change-failure-rate / MTTR all derive from this. MANAGER+ (or a
  // CI service key). is_failure flags a bad deploy; restoredAt closes MTTR.
  router.post('/deployments', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      projectId?: number | null;
      taskId?: number | null;
      environment?: string;
      status?: 'success' | 'failed' | 'rolled_back';
      isFailure?: boolean;
      externalRef?: string | null;
      deployedAt?: string | null;
      restoredAt?: string | null;
    }>();
    const [row] = await db
      .insert(deploymentEvents)
      .values({
        tenantId,
        projectId: body.projectId ?? null,
        taskId: body.taskId ?? null,
        environment: body.environment ?? 'production',
        status: body.status ?? 'success',
        isFailure: body.isFailure ?? (body.status === 'failed'),
        externalRef: body.externalRef ?? null,
        deployedAt: body.deployedAt ? new Date(body.deployedAt) : new Date(),
        restoredAt: body.restoredAt ? new Date(body.restoredAt) : null,
      })
      .returning();
    await bumpWorkforceMetricsVersion(c.env as Env, tenantId).catch(() => {});
    return c.json({ deployment: row }, 201);
  });

  return router;
}

/** Resolve + decrypt the workspace's enabled Google Calendar credential (the
 *  first one), or null when none is connected. Uses the same AES-GCM secret as the
 *  integrations CRUD (INTEGRATION_ENCRYPTION_SECRET, falling back to JWT_SECRET). */
async function resolveGoogleCalendarCredential(env: Env, db: Db, tenantId: number): Promise<CalendarCredential | null> {
  const [row] = await db
    .select({ credentialsEnc: integrationCredentials.credentialsEnc, iv: integrationCredentials.iv })
    .from(integrationCredentials)
    .where(and(
      eq(integrationCredentials.tenantId, tenantId),
      eq(integrationCredentials.provider, 'google_calendar'),
      eq(integrationCredentials.isEnabled, true),
    ))
    .limit(1);
  if (!row) return null;
  const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
  const secret = e.INTEGRATION_ENCRYPTION_SECRET ?? e.JWT_SECRET ?? '';
  const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
  if (!creds) return null;
  return { accessToken: creds.accessToken as string | undefined, refreshToken: creds.refreshToken as string | undefined };
}

/** Upsert one period snapshot per member into member_metrics_period. The period
 *  is [now − days, now]; re-running the same window overwrites its row. */
async function snapshotMetrics(db: Db, tenantId: number, days: number, cards: MemberScorecard[]): Promise<void> {
  if (!cards.length) return;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 3_600_000);
  for (const m of cards) {
    await db
      .insert(memberMetricsPeriod)
      .values({
        tenantId,
        memberKind: m.memberKind,
        memberRef: m.memberRef,
        memberName: m.memberName,
        periodStart,
        periodEnd,
        assignedCount: m.assignedCount,
        completedCount: m.completedCount,
        redoCount: m.redoCount,
        reopenCount: m.reopenCount,
        avgCycleTimeHours: m.avgCycleTimeHours,
        avgPickupLatencyHours: m.avgPickupLatencyHours,
        avgIdleAfterDoneHours: m.avgIdleAfterDoneHours,
        boardHygieneScore: m.boardHygieneScore,
        engagementScore: m.engagementScore,
        effectivenessScore: m.effectivenessScore,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          memberMetricsPeriod.tenantId,
          memberMetricsPeriod.memberKind,
          memberMetricsPeriod.memberRef,
          memberMetricsPeriod.periodStart,
          memberMetricsPeriod.periodEnd,
        ],
        set: {
          memberName: m.memberName,
          assignedCount: m.assignedCount,
          completedCount: m.completedCount,
          redoCount: m.redoCount,
          reopenCount: m.reopenCount,
          avgCycleTimeHours: m.avgCycleTimeHours,
          avgPickupLatencyHours: m.avgPickupLatencyHours,
          avgIdleAfterDoneHours: m.avgIdleAfterDoneHours,
          boardHygieneScore: m.boardHygieneScore,
          engagementScore: m.engagementScore,
          effectivenessScore: m.effectivenessScore,
          computedAt: new Date(),
        },
      });
  }
}
