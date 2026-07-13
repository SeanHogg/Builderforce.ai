/**
 * Planning Poker + Retrospectives (doc 03). Nested session models with
 * vote/reveal actions — not flat trackers, so custom (but still fully
 * segment-scoped) routes. Live updates are pushed over WebSocket: each `/ws`
 * route relays to a SessionRoomDO, and every mutation POSTs `/broadcast` so
 * connected clients re-fetch. Mounted under /api/agile by agileRoutes.
 */

import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import {
  pokerSessions, pokerStories, pokerVotes, retrospectives, retroItems,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { broadcastRoom } from '../../infrastructure/relay/broadcastRoom';
import { relayToRoom } from './realtimeRelay';

/** Resolve a story's parent session (to know which room to broadcast to). */
async function sessionIdForStory(db: Db, storyId: string, tenantId: number, segmentId: string): Promise<string | null> {
  const [s] = await db.select({ sessionId: pokerStories.sessionId }).from(pokerStories)
    .where(and(eq(pokerStories.id, storyId), eq(pokerStories.tenantId, tenantId), eq(pokerStories.segmentId, segmentId))).limit(1);
  return s?.sessionId ?? null;
}

export function createPokerRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Live channel: clients hold this WebSocket and re-fetch on each `changed` push.
  r.get('/sessions/:id/ws', (c) => relayToRoom(c, c.env?.SESSION_ROOM, `poker:${c.req.param('id')}`));

  r.get('/sessions', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json(await db.select().from(pokerSessions)
      .where(and(eq(pokerSessions.tenantId, tenantId), eq(pokerSessions.segmentId, segmentId))));
  });

  r.post('/sessions', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ name?: string; votingSystem?: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const [row] = await db.insert(pokerSessions).values({
      tenantId, segmentId, name: body.name.trim(),
      votingSystem: body.votingSystem ?? 'fibonacci', facilitatorId: c.get('userId'),
    }).returning();
    return c.json(row, 201);
  });

  // Session detail: stories + votes. Unrevealed vote VALUES are hidden (poker rule).
  r.get('/sessions/:id', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const [session] = await db.select().from(pokerSessions)
      .where(and(eq(pokerSessions.id, id), eq(pokerSessions.tenantId, tenantId), eq(pokerSessions.segmentId, segmentId))).limit(1);
    if (!session) return c.json({ error: 'not found' }, 404);
    const stories = await db.select().from(pokerStories)
      .where(and(eq(pokerStories.sessionId, id), eq(pokerStories.tenantId, tenantId), eq(pokerStories.segmentId, segmentId)))
      .orderBy(pokerStories.position);
    const storyIds = stories.map((s) => s.id);
    const votes = storyIds.length
      ? await db.select().from(pokerVotes)
          .where(and(eq(pokerVotes.tenantId, tenantId), eq(pokerVotes.segmentId, segmentId), inArray(pokerVotes.storyId, storyIds)))
      : [];
    return c.json({
      ...session,
      stories: stories.map((s) => ({
        ...s,
        votes: votes.filter((v) => v.storyId === s.id).map((v) => ({
          userId: v.userId,
          value: v.isRevealed ? v.value : null, // hidden until revealed
          isRevealed: v.isRevealed,
        })),
      })),
    });
  });

  r.post('/sessions/:id/stories', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const sessionId = c.req.param('id');
    const body = await c.req.json<{ title?: string; description?: string }>();
    if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
    const counted = await db.select({ count: sql<number>`count(*)::int` }).from(pokerStories)
      .where(and(eq(pokerStories.sessionId, sessionId), eq(pokerStories.tenantId, tenantId), eq(pokerStories.segmentId, segmentId)));
    const [row] = await db.insert(pokerStories).values({
      tenantId, segmentId, sessionId, title: body.title.trim(), description: body.description ?? null, position: counted[0]?.count ?? 0,
    }).returning();
    await broadcastRoom(c.env?.SESSION_ROOM, `poker:${sessionId}`);
    return c.json(row, 201);
  });

  // Cast/replace the caller's vote for a story (any member can vote).
  r.post('/stories/:id/vote', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const storyId = c.req.param('id');
    const userId = c.get('userId');
    const body = await c.req.json<{ value?: string }>();
    if (!body.value?.trim()) return c.json({ error: 'value is required' }, 400);
    await db.insert(pokerVotes).values({ tenantId, segmentId, storyId, userId, value: body.value.trim() })
      .onConflictDoUpdate({ target: [pokerVotes.storyId, pokerVotes.userId], set: { value: body.value.trim(), updatedAt: new Date() } });
    const sessionId = await sessionIdForStory(db, storyId, tenantId, segmentId);
    if (sessionId) await broadcastRoom(c.env?.SESSION_ROOM, `poker:${sessionId}`);
    return c.json({ ok: true });
  });

  r.post('/stories/:id/reveal', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const storyId = c.req.param('id');
    await db.update(pokerVotes).set({ isRevealed: true, updatedAt: new Date() })
      .where(and(eq(pokerVotes.storyId, storyId), eq(pokerVotes.tenantId, tenantId), eq(pokerVotes.segmentId, segmentId)));
    await db.update(pokerStories).set({ status: 'revealed', updatedAt: new Date() })
      .where(and(eq(pokerStories.id, storyId), eq(pokerStories.tenantId, tenantId), eq(pokerStories.segmentId, segmentId)));
    const sessionId = await sessionIdForStory(db, storyId, tenantId, segmentId);
    if (sessionId) await broadcastRoom(c.env?.SESSION_ROOM, `poker:${sessionId}`);
    return c.json({ ok: true });
  });

  r.patch('/stories/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const body = await c.req.json<{ finalEstimate?: string; status?: string }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.finalEstimate !== undefined) { patch.finalEstimate = body.finalEstimate; patch.status = 'estimated'; }
    if (body.status !== undefined) patch.status = body.status;
    const [row] = await db.update(pokerStories).set(patch)
      .where(and(eq(pokerStories.id, id), eq(pokerStories.tenantId, tenantId), eq(pokerStories.segmentId, segmentId))).returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    await broadcastRoom(c.env?.SESSION_ROOM, `poker:${row.sessionId}`);
    return c.json(row);
  });

  return r;
}

export function createRetroRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Live channel (see poker).
  r.get('/:id/ws', (c) => relayToRoom(c, c.env?.SESSION_ROOM, `retro:${c.req.param('id')}`));

  r.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json(await db.select().from(retrospectives)
      .where(and(eq(retrospectives.tenantId, tenantId), eq(retrospectives.segmentId, segmentId))));
  });

  r.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ name?: string; template?: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const [row] = await db.insert(retrospectives).values({
      tenantId, segmentId, name: body.name.trim(), template: body.template ?? 'start_stop_continue',
    }).returning();
    return c.json(row, 201);
  });

  r.get('/:id', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const [retro] = await db.select().from(retrospectives)
      .where(and(eq(retrospectives.id, id), eq(retrospectives.tenantId, tenantId), eq(retrospectives.segmentId, segmentId))).limit(1);
    if (!retro) return c.json({ error: 'not found' }, 404);
    const items = await db.select().from(retroItems)
      .where(and(eq(retroItems.retroId, id), eq(retroItems.tenantId, tenantId), eq(retroItems.segmentId, segmentId)));
    return c.json({ ...retro, items });
  });

  // Any member can add an item.
  r.post('/:id/items', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const retroId = c.req.param('id');
    const body = await c.req.json<{ category?: string; content?: string }>();
    if (!body.category?.trim() || !body.content?.trim()) return c.json({ error: 'category and content are required' }, 400);
    const [row] = await db.insert(retroItems).values({
      tenantId, segmentId, retroId, category: body.category.trim(), content: body.content.trim(), authorId: c.get('userId'),
    }).returning();
    await broadcastRoom(c.env?.SESSION_ROOM, `retro:${retroId}`);
    return c.json(row, 201);
  });

  // Any member can upvote an item.
  r.post('/items/:id/vote', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const [row] = await db.update(retroItems).set({ votes: sql`${retroItems.votes} + 1`, updatedAt: new Date() })
      .where(and(eq(retroItems.id, id), eq(retroItems.tenantId, tenantId), eq(retroItems.segmentId, segmentId))).returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    await broadcastRoom(c.env?.SESSION_ROOM, `retro:${row.retroId}`);
    return c.json(row);
  });

  r.delete('/items/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id');
    const [row] = await db.delete(retroItems)
      .where(and(eq(retroItems.id, id), eq(retroItems.tenantId, tenantId), eq(retroItems.segmentId, segmentId))).returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    await broadcastRoom(c.env?.SESSION_ROOM, `retro:${row.retroId}`);
    return c.json({ deleted: row.id });
  });

  return r;
}
