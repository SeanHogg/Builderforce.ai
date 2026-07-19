/**
 * Ceremonies — /api/agile/ceremonies.
 *
 * Two concerns:
 *  1. The live multiplayer transport (WebSocket relay via CeremonyRoomDO, keyed
 *     `ceremony:<projectId>`) — clients exchange presence/cursor frames and relay
 *     a `changed` signal after a mutation so peers re-fetch. Task/sprint/epic
 *     mutations stay on the existing task + agile REST routes.
 *  2. Tracked sessions — an officially-started, timed standup/planning with
 *     per-participant turn durations (persisted in ceremony_sessions /
 *     ceremony_participants).
 *  3. Schedules — the cadence layer (migration 0349). A ceremony no longer needs a
 *     human to click "start": the frequent cron sweep (application/ceremony/
 *     runDueCeremonies) opens a session with its roster pre-seeded for every due
 *     `ceremony_schedules` row. Cadence is a 5-field cron + IANA timezone, the same
 *     representation qa_schedules / workflow_triggers use.
 *
 * Completing a session server-side dispatches the project's agent-owned work via
 * the canonical lane-entry gate (bounded). That dispatch used to run in the
 * browser, which made it depend on a tab staying open.
 *
 * Per-member scorecards / capacity are NOT served here — they live in the member
 * metrics system (`GET /api/members/metrics`, `GET /api/members/profiles`); the
 * ceremony UI consumes those directly (no duplicate aggregation).
 *
 * Session mutations are MANAGER+; the facilitator's client broadcasts `changed`
 * over the room so peers re-fetch (no server-side room coupling).
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { ceremonySessions, ceremonyParticipants, ceremonySchedules, boards } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { computeCeremonyRollup } from '../../application/insights/ceremonyRollup';
import { dispatchCeremonyCompletion } from '../../application/ceremony/runDueCeremonies';
import { isValidCron, nextCronTime } from '../../domain/workflowSchedule';
import { relayToRoom } from './realtimeRelay';

/** Cache key for a project's ceremony schedules list. */
function schedulesCacheKey(tenantId: number, segmentId: string, projectId: number): string {
  return `ceremony-schedules:t:${tenantId}:s:${segmentId}:p:${projectId}`;
}

/** The ceremony kinds that exist — mirrors ceremonySessions.kind exactly. Retros
 *  are a separate subsystem (retrospectives) and are deliberately not modelled here. */
const CEREMONY_KINDS = new Set(['standup', 'planning']);

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

export function createCeremonyRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Live channel: clients hold this WebSocket for presence + relayed updates.
  r.get('/rooms/:id/ws', (c) => relayToRoom(c, c.env?.CEREMONY_ROOM, `ceremony:${c.req.param('id')}`));

  // ── Tenant-wide ceremonies rollup ("insights everywhere") ───────────────────
  // Cadence + engagement across ALL projects' standups/plannings — the per-project
  // sessions read can't answer "are we running ceremonies, and who dominates?".
  // Manager-gated (an ops/EM view); short TTL over the hot sessions tables.
  r.get('/rollup', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const env = c.env as Env;
    const key = `agile:ceremonies-rollup:t:${tenantId}:d:${days}`;
    return c.json(await getOrSetCached(env, key, () => computeCeremonyRollup(db, tenantId, days), { kvTtlSeconds: 60, l1TtlMs: 15_000 }));
  });

  // ── Sessions ───────────────────────────────────────────────────────────────

  /** Hydrate a session + its participants (ordered) for the response. */
  async function hydrate(tenantId: number, segmentId: string, sessionId: string) {
    const [session] = await db.select().from(ceremonySessions)
      .where(and(eq(ceremonySessions.id, sessionId), eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId)));
    if (!session) return null;
    const participants = await db.select().from(ceremonyParticipants)
      .where(eq(ceremonyParticipants.sessionId, sessionId));
    participants.sort((a, b) => a.turnOrder - b.turnOrder);
    return { session, participants };
  }

  /** Add `elapsedMs` to the participant currently in `turnOrder` of a session. */
  async function accrueTurn(sessionId: string, turnOrder: number, elapsedMs: number) {
    if (elapsedMs <= 0) return;
    const [p] = await db.select().from(ceremonyParticipants)
      .where(and(eq(ceremonyParticipants.sessionId, sessionId), eq(ceremonyParticipants.turnOrder, turnOrder)));
    if (!p) return;
    await db.update(ceremonyParticipants)
      .set({ durationMs: p.durationMs + elapsedMs, updatedAt: new Date() })
      .where(eq(ceremonyParticipants.id, p.id));
  }

  // GET /sessions?projectId=&kind= — the active session for a board+kind (or null).
  r.get('/sessions', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = Number(c.req.query('projectId'));
    const kind = c.req.query('kind') ?? 'standup';
    if (!projectId) return c.json({ error: 'projectId is required' }, 400);
    const [active] = await db.select().from(ceremonySessions).where(and(
      eq(ceremonySessions.tenantId, tenantId),
      eq(ceremonySessions.segmentId, segmentId),
      eq(ceremonySessions.projectId, projectId),
      eq(ceremonySessions.kind, kind),
      eq(ceremonySessions.status, 'active'),
    ));
    if (!active) return c.json({ session: null });
    return c.json(await hydrate(tenantId, segmentId, active.id));
  });

  // POST /sessions — start (or return the existing active) session.
  r.post('/sessions', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{
      projectId: number;
      kind?: string;
      participants?: Array<{ kind: string; ref: string; name: string }>;
    }>();
    const kind = body.kind ?? 'standup';
    if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);

    // Idempotent start: return the existing live session for this board+kind.
    const [existing] = await db.select().from(ceremonySessions).where(and(
      eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId),
      eq(ceremonySessions.projectId, body.projectId), eq(ceremonySessions.kind, kind),
      eq(ceremonySessions.status, 'active'),
    ));
    if (existing) return c.json(await hydrate(tenantId, segmentId, existing.id));

    // Snapshot the board's standup turn settings onto the session.
    const [board] = await db.select({ mode: boards.standupTurnMode, seconds: boards.standupTurnSeconds })
      .from(boards).where(and(eq(boards.tenantId, tenantId), eq(boards.projectId, body.projectId)));
    const now = new Date();
    const isStandup = kind === 'standup';

    const [session] = await db.insert(ceremonySessions).values({
      tenantId, segmentId,
      projectId: body.projectId,
      kind,
      status: 'active',
      facilitatorId: c.get('userId') ?? null,
      turnMode: board?.mode ?? 'facilitator',
      turnSeconds: board?.seconds ?? 90,
      currentTurn: isStandup ? 0 : null,
      turnStartedAt: isStandup ? now : null,
      startedAt: now,
    }).returning();
    if (!session) return c.json({ error: 'Failed to create session' }, 500);

    const parts = (body.participants ?? []).filter((p) => p.ref);
    if (parts.length > 0) {
      await db.insert(ceremonyParticipants).values(parts.map((p, i) => ({
        tenantId, segmentId,
        sessionId: session.id,
        memberKind: p.kind,
        memberRef: p.ref,
        memberName: p.name,
        turnOrder: i,
      })));
    }
    return c.json(await hydrate(tenantId, segmentId, session.id), 201);
  });

  // PATCH /sessions/:id/turn — advance the speaker, accruing the outgoing turn.
  r.patch('/sessions/:id/turn', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const body = await c.req.json<{ currentTurn: number }>();
    const [session] = await db.select().from(ceremonySessions)
      .where(and(eq(ceremonySessions.id, id), eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId)));
    if (!session) return c.json({ error: 'Not found' }, 404);

    const now = new Date();
    if (session.currentTurn != null && session.turnStartedAt) {
      await accrueTurn(id, session.currentTurn, now.getTime() - session.turnStartedAt.getTime());
    }
    await db.update(ceremonySessions)
      .set({ currentTurn: body.currentTurn, turnStartedAt: now, updatedAt: now })
      .where(eq(ceremonySessions.id, id));
    return c.json(await hydrate(tenantId, segmentId, id));
  });

  // POST /sessions/:id/complete — end the session, accruing the final turn.
  r.post('/sessions/:id/complete', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const [session] = await db.select().from(ceremonySessions)
      .where(and(eq(ceremonySessions.id, id), eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId)));
    if (!session) return c.json({ error: 'Not found' }, 404);

    const now = new Date();
    if (session.currentTurn != null && session.turnStartedAt) {
      await accrueTurn(id, session.currentTurn, now.getTime() - session.turnStartedAt.getTime());
    }
    await db.update(ceremonySessions)
      .set({ status: 'completed', endedAt: now, currentTurn: null, turnStartedAt: null, updatedAt: now })
      .where(eq(ceremonySessions.id, id));

    // Auto-dispatch the project's agent-owned work now that the ceremony is over.
    // This used to run in the browser (CeremonyStage.completeSession), which made a
    // core automation depend on a tab staying open and swallowed every failure. It
    // now runs here, through the canonical lane-entry gate, bounded per ceremony.
    // Registered on executionCtx so the response isn't held on agent kickoff.
    const dispatch = dispatchCeremonyCompletion(c.env as Env, db, {
      tenantId, projectId: session.projectId, sessionId: id,
    }).catch((err) => { console.error('[ceremony:complete] dispatch failed', err); });
    if (c.executionCtx) c.executionCtx.waitUntil(dispatch); else await dispatch;

    return c.json(await hydrate(tenantId, segmentId, id));
  });

  // ── Schedules ──────────────────────────────────────────────────────────────
  // The cadence layer: the frequent cron sweep (runDueCeremonies) opens a session
  // with its roster pre-seeded for every due row. Cadence is a 5-field cron + IANA
  // timezone — the SAME representation as qa_schedules / workflow_triggers.
  // Reads are member-level; writes are MANAGER+.

  r.get('/schedules', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = Number(c.req.query('projectId'));
    if (!projectId) return c.json({ error: 'projectId is required' }, 400);
    const env = c.env as Env;
    const schedules = await getOrSetCached(
      env,
      schedulesCacheKey(tenantId, segmentId, projectId),
      () => db.select().from(ceremonySchedules).where(and(
        eq(ceremonySchedules.tenantId, tenantId),
        eq(ceremonySchedules.segmentId, segmentId),
        eq(ceremonySchedules.projectId, projectId),
      )).orderBy(desc(ceremonySchedules.updatedAt)),
      { kvTtlSeconds: 120, l1TtlMs: 15_000 },
    );
    return c.json({ schedules });
  });

  r.post('/schedules', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json().catch(() => ({})) as {
      projectId?: number; kind?: string; cron?: string; timezone?: string; enabled?: boolean;
      turnMode?: string | null; turnSeconds?: number | null;
      participantScope?: string; participants?: Array<{ kind: string; ref: string; name: string }>;
      maxParticipants?: number; autoDispatch?: boolean;
    };
    if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);
    if (!body.cron || !isValidCron(body.cron)) return c.json({ error: 'A valid cron expression is required' }, 400);
    const kind = body.kind ?? 'standup';
    if (!CEREMONY_KINDS.has(kind)) return c.json({ error: 'kind must be standup or planning' }, 400);

    const timezone = body.timezone ?? 'UTC';
    const enabled = body.enabled ?? true;
    const [schedule] = await db.insert(ceremonySchedules).values({
      tenantId, segmentId, projectId: body.projectId, kind,
      cron: body.cron, timezone, enabled,
      turnMode: body.turnMode ?? null,
      turnSeconds: body.turnSeconds ?? null,
      participantScope: body.participantScope === 'roster' ? 'roster' : 'members',
      participants: JSON.stringify(body.participants ?? []),
      maxParticipants: Math.min(Math.max(1, body.maxParticipants ?? 25), 100),
      autoDispatch: body.autoDispatch ?? false,
      // Arm at create time — the sweep treats an unarmed row as NOT due, so this is
      // the first-poll guard: a new schedule fires at its first real cadence instant.
      nextRunAt: enabled ? nextCronTime(body.cron, new Date(), timezone) : null,
      createdBy: c.get('userId') ?? null,
      updatedAt: new Date(),
    }).returning();
    if (!schedule) return c.json({ error: 'Failed to create schedule' }, 500);
    await invalidateCached(c.env as Env, schedulesCacheKey(tenantId, segmentId, body.projectId)).catch(() => {});
    return c.json({ schedule }, 201);
  });

  r.patch('/schedules/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      kind?: string; cron?: string; timezone?: string; enabled?: boolean;
      turnMode?: string | null; turnSeconds?: number | null;
      participantScope?: string; participants?: Array<{ kind: string; ref: string; name: string }>;
      maxParticipants?: number; autoDispatch?: boolean;
    };
    if (body.cron !== undefined && !isValidCron(body.cron)) return c.json({ error: 'Invalid cron expression' }, 400);
    if (body.kind !== undefined && !CEREMONY_KINDS.has(body.kind)) return c.json({ error: 'kind must be standup or planning' }, 400);

    const [existing] = await db.select().from(ceremonySchedules).where(and(
      eq(ceremonySchedules.id, id), eq(ceremonySchedules.tenantId, tenantId), eq(ceremonySchedules.segmentId, segmentId),
    ));
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['kind', 'cron', 'timezone', 'enabled', 'turnMode', 'turnSeconds', 'autoDispatch'] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (body.participantScope !== undefined) patch.participantScope = body.participantScope === 'roster' ? 'roster' : 'members';
    if (body.participants !== undefined) patch.participants = JSON.stringify(body.participants);
    if (body.maxParticipants !== undefined) patch.maxParticipants = Math.min(Math.max(1, body.maxParticipants), 100);

    // Re-arm when the cadence changes or the row is (re)enabled; disarm on disable
    // so a paused schedule can't fire the instant it is re-enabled.
    const enabled = body.enabled ?? existing.enabled;
    if (!enabled) {
      patch.nextRunAt = null;
    } else if (body.cron !== undefined || body.timezone !== undefined || body.enabled === true) {
      patch.nextRunAt = nextCronTime(body.cron ?? existing.cron, new Date(), body.timezone ?? existing.timezone);
    }

    const [schedule] = await db.update(ceremonySchedules).set(patch)
      .where(and(eq(ceremonySchedules.id, id), eq(ceremonySchedules.tenantId, tenantId)))
      .returning();
    if (!schedule) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, schedulesCacheKey(tenantId, segmentId, existing.projectId)).catch(() => {});
    return c.json({ schedule });
  });

  r.delete('/schedules/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const [schedule] = await db.delete(ceremonySchedules)
      .where(and(eq(ceremonySchedules.id, c.req.param('id')), eq(ceremonySchedules.tenantId, tenantId), eq(ceremonySchedules.segmentId, segmentId)))
      .returning({ projectId: ceremonySchedules.projectId });
    if (!schedule) return c.json({ error: 'Not found' }, 404);
    await invalidateCached(c.env as Env, schedulesCacheKey(tenantId, segmentId, schedule.projectId)).catch(() => {});
    return c.json({ deleted: true });
  });

  return r;
}
