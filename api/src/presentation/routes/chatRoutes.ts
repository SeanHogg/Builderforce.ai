/**
 * Chat persistence routes
 *
 * POST /api/claws/:clawId/messages?key=  — claw-key auth; upserts session + bulk inserts messages
 * GET  /api/chats                         — JWT tenant auth; lists chat sessions across all claws
 * GET  /api/chats/:sessionId/messages     — JWT tenant auth; messages for a session
 * GET  /api/claws/:clawId/sessions/:sessionKey/messages  — JWT tenant auth; messages by session key
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  coderclawInstances,
  chatSessions,
  chatMessages,
} from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createChatRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ---------------------------------------------------------------------------
  // Helper: verify claw API key (same pattern as clawRoutes)
  // ---------------------------------------------------------------------------
  const verifyClawApiKey = async (id: number, key?: string) => {
    if (!key) return null;
    const [claw] = await db
      .select({
        id: coderclawInstances.id,
        tenantId: coderclawInstances.tenantId,
        apiKeyHash: coderclawInstances.apiKeyHash,
      })
      .from(coderclawInstances)
      .where(eq(coderclawInstances.id, id));
    if (!claw) return null;
    const valid = await verifySecret(key, claw.apiKeyHash);
    return valid ? claw : null;
  };

  // ---------------------------------------------------------------------------
  // POST /api/claws/:clawId/messages?key=<clawApiKey>
  // Relay DO calls this to persist messages. Creates/upserts the session row
  // and bulk-inserts messages. Authentication via the claw's own API key.
  // ---------------------------------------------------------------------------
  router.post('/claws/:clawId/messages', async (c) => {
    const clawId = Number(c.req.param('clawId'));
    const key = c.req.query('key');

    if (Number.isNaN(clawId) || clawId <= 0) {
      return c.json({ error: 'invalid clawId' }, 400);
    }

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    let body: { sessionKey: string; projectId?: number; messages: Array<{ role: string; content: string; metadata?: string; seq: number }> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const { sessionKey, projectId, messages } = body;
    if (!sessionKey) return c.json({ error: 'sessionKey is required' }, 400);
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ ok: true, inserted: 0 });
    }

    // Upsert chat_sessions row
    let session: { id: number } | undefined;
    const [existing] = await db
      .select({ id: chatSessions.id, msgCount: chatSessions.msgCount })
      .from(chatSessions)
      .where(and(
        eq(chatSessions.clawId, clawId),
        eq(chatSessions.tenantId, claw.tenantId),
        eq(chatSessions.sessionKey, sessionKey),
      ));

    if (existing) {
      session = existing;
    } else {
      const [inserted] = await db
        .insert(chatSessions)
        .values({
          tenantId: claw.tenantId,
          clawId,
          sessionKey,
          projectId: projectId ?? null,
        })
        .returning({ id: chatSessions.id });
      session = inserted;
    }

    if (!session) return c.json({ error: 'failed to upsert session' }, 500);

    // Insert messages
    let inserted = 0;
    for (const msg of messages) {
      if (!msg.role || typeof msg.content !== 'string') continue;
      try {
        await db.insert(chatMessages).values({
          tenantId: claw.tenantId,
          clawId,
          sessionId: session.id,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata ?? null,
          seq: msg.seq,
        });
        inserted++;
      } catch {
        // Skip duplicates (seq conflict) — idempotent
      }
    }

    // Update session stats
    const lastMsg = messages[messages.length - 1];
    await db
      .update(chatSessions)
      .set({
        msgCount: (existing?.msgCount ?? 0) + inserted,
        lastMsgAt: new Date(),
      })
      .where(eq(chatSessions.id, session.id));

    return c.json({ ok: true, inserted, sessionId: session.id });
  });

  // ---------------------------------------------------------------------------
  // GET /api/chats?limit=&offset=   — tenant JWT; all sessions across all claws
  // ---------------------------------------------------------------------------
  router.get('/chats', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit  = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const rows = await db
      .select({
        id:         chatSessions.id,
        clawId:     chatSessions.clawId,
        clawName:   coderclawInstances.name,
        sessionKey: chatSessions.sessionKey,
        projectId:  chatSessions.projectId,
        startedAt:  chatSessions.startedAt,
        endedAt:    chatSessions.endedAt,
        msgCount:   chatSessions.msgCount,
        lastMsgAt:  chatSessions.lastMsgAt,
      })
      .from(chatSessions)
      .innerJoin(coderclawInstances, eq(coderclawInstances.id, chatSessions.clawId))
      .where(eq(chatSessions.tenantId, tenantId))
      .orderBy(desc(chatSessions.lastMsgAt))
      .limit(limit)
      .offset(offset);

    return c.json({ sessions: rows });
  });

  // ---------------------------------------------------------------------------
  // GET /api/chats/:sessionId/messages?limit=   — tenant JWT; messages for session
  // ---------------------------------------------------------------------------
  router.get('/chats/:sessionId/messages', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const sessionId = Number(c.req.param('sessionId'));
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 200);

    if (Number.isNaN(sessionId)) return c.json({ error: 'invalid sessionId' }, 400);

    // Verify the session belongs to this tenant
    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.tenantId, tenantId),
      ));

    if (!session) return c.json({ error: 'not found' }, 404);

    const msgs = await db
      .select({
        id:        chatMessages.id,
        role:      chatMessages.role,
        content:   chatMessages.content,
        metadata:  chatMessages.metadata,
        seq:       chatMessages.seq,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.seq)
      .limit(limit);

    return c.json({ messages: msgs });
  });

  // ---------------------------------------------------------------------------
  // GET /api/claws/:clawId/sessions/:sessionKey/messages?limit=   — JWT auth
  // Browser client fetches history for the active session by key.
  // ---------------------------------------------------------------------------
  router.get('/claws/:clawId/sessions/:sessionKey/messages', authMiddleware as never, async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const clawId    = Number(c.req.param('clawId'));
    const sessionKey = c.req.param('sessionKey');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    if (Number.isNaN(clawId) || !sessionKey) {
      return c.json({ error: 'invalid params' }, 400);
    }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(
        eq(chatSessions.clawId, clawId),
        eq(chatSessions.tenantId, tenantId),
        eq(chatSessions.sessionKey, sessionKey),
      ));

    if (!session) return c.json({ messages: [] });

    const msgs = await db
      .select({
        id:        chatMessages.id,
        role:      chatMessages.role,
        content:   chatMessages.content,
        metadata:  chatMessages.metadata,
        seq:       chatMessages.seq,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id))
      .orderBy(chatMessages.seq)
      .limit(limit);

    return c.json({ messages: msgs });
  });

  return router;
}
