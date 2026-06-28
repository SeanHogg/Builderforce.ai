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
 *
 * Per-member scorecards / capacity are NOT served here — they live in the member
 * metrics system (`GET /api/members/metrics`, `GET /api/members/profiles`); the
 * ceremony UI consumes those directly (no duplicate aggregation).
 *
 * Session mutations are MANAGER+; the facilitator's client broadcasts `changed`
 * over the room so peers re-fetch (no server-side room coupling).
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { ceremonySessions, ceremonyParticipants, boards } from '../../infrastructure/database/schema';
import { relayToRoom } from './realtimeRelay';

export function createCeremonyRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Live channel: clients hold this WebSocket for presence + relayed updates.
  r.get('/rooms/:id/ws', (c) => relayToRoom(c, c.env?.CEREMONY_ROOM, `ceremony:${c.req.param('id')}`));

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
    return c.json(await hydrate(tenantId, segmentId, id));
  });

  return r;
}
