/**
 * Chat persistence routes
 *
 * POST /api/agent-hosts/:agentHostId/messages?key=  — agentHost-key auth; upserts session + bulk inserts messages
 * GET  /api/chats                         — JWT tenant auth; lists chat sessions across all agentHosts
 * GET  /api/chats/:sessionId/messages     — JWT tenant auth; messages for a session
 * GET  /api/agent-hosts/:agentHostId/sessions/:sessionKey/messages  — JWT tenant auth; messages by session key
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  agentHosts,
  chatSessions,
  chatMessages,
} from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createChatRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ---------------------------------------------------------------------------
  // POST /api/agent-hosts/:agentHostId/messages?key=<agentHostApiKey>
  // Relay DO calls this to persist messages. Creates/upserts the session row
  // and bulk-inserts messages. Authentication via the agentHost's own API key.
  // ---------------------------------------------------------------------------
  router.post('/agentHosts/:agentHostId/messages', async (c) => {
    const agentHostId = Number(c.req.param('agentHostId'));
    const key = c.req.query('key');

    if (Number.isNaN(agentHostId) || agentHostId <= 0) {
      return c.json({ error: 'invalid agentHostId' }, 400);
    }

    const agentHost = await verifyAgentHostApiKey(db, agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

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
        eq(chatSessions.agentHostId, agentHostId),
        eq(chatSessions.tenantId, agentHost.tenantId),
        eq(chatSessions.sessionKey, sessionKey),
      ));

    if (existing) {
      session = existing;
    } else {
      const [inserted] = await db
        .insert(chatSessions)
        .values({
          tenantId: agentHost.tenantId,
          agentHostId,
          sessionKey,
          projectId: projectId ?? null,
        })
        .returning({ id: chatSessions.id });
      session = inserted;
    }

    if (!session) return c.json({ error: 'failed to upsert session' }, 500);

    // Insert messages — ONE multi-row insert (neon-http has no interactive tx).
    // onConflictDoNothing keeps the idempotent "skip duplicates" behavior; the
    // returned rows are exactly those actually inserted, so `inserted` is accurate.
    let inserted = 0;
    const rows = messages
      .filter((msg) => msg.role && typeof msg.content === 'string')
      .map((msg) => ({
        tenantId: agentHost.tenantId,
        agentHostId,
        sessionId: session.id,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata ?? null,
        seq: msg.seq,
      }));
    if (rows.length > 0) {
      const insertedRows = await db
        .insert(chatMessages)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: chatMessages.id });
      inserted = insertedRows.length;
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
  // GET /api/chats?limit=&offset=   — tenant JWT; all sessions across all agentHosts
  // ---------------------------------------------------------------------------
  router.get('/chats', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit  = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const rows = await db
      .select({
        id:         chatSessions.id,
        agentHostId:     chatSessions.agentHostId,
        agentHostName:   agentHosts.name,
        sessionKey: chatSessions.sessionKey,
        projectId:  chatSessions.projectId,
        startedAt:  chatSessions.startedAt,
        endedAt:    chatSessions.endedAt,
        msgCount:   chatSessions.msgCount,
        lastMsgAt:  chatSessions.lastMsgAt,
      })
      .from(chatSessions)
      .innerJoin(agentHosts, eq(agentHosts.id, chatSessions.agentHostId))
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
  // GET /api/agent-hosts/:agentHostId/sessions/:sessionKey/messages?limit=   — JWT auth
  // Browser client fetches history for the active session by key.
  // ---------------------------------------------------------------------------
  router.get('/agentHosts/:agentHostId/sessions/:sessionKey/messages', authMiddleware as never, async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const agentHostId    = Number(c.req.param('agentHostId'));
    const sessionKey = c.req.param('sessionKey');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    if (Number.isNaN(agentHostId) || !sessionKey) {
      return c.json({ error: 'invalid params' }, 400);
    }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(
        eq(chatSessions.agentHostId, agentHostId),
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

  // -----------------------------------------------------------------------
  // POST /api/brain/sessions/{target}/consolidate — merge given upstream sources into target
  // -----------------------------------------------------------------------
  router.post('/brain/sessions/:target/consolidate', authMiddleware as never, async (c) => {
    const db = c.get('db');
    const targetId = c.req.param('target');
    if (!targetId || targetId.includes('/')) {
      return c.json({ error: 'invalid targetId' }, 400);
    }
    const [targetRow] = await db
      .select({ id: chatSessions.id, msgCount: chatSessions.msgCount })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, Number(targetId)), eq(chatSessions.tenantId, c.get('tenantId'))));
    if (!targetRow) {
      return c.json({ error: 'target session not found' }, 404);
    }

    let payload: { sourceRefs: string[]; assignedUserId?: string; notes?: string };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }
    if (!Array.isArray(payload.sourceRefs) || payload.sourceRefs.length === 0) {
      return c.json({ error: 'sourceRefs is required and must be a non-empty array' }, 400);
    }
    if (payload.sourceRefs.length > 200) {
      return c.json({ error: 'sourceRefs length must be ≤ 200' }, 400);
    }

    // Validate each source session exists
    const sourceIds: number[] = [];
    for (const ref of payload.sourceRefs) {
      const [sourceRow] = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.sessionKey, ref), eq(chatSessions.tenantId, c.get('tenantId'))));
      if (!sourceRow) {
        return c.json({ error: `sourceRef not found: ${ref}` }, 404);
      }
      sourceIds.push(Number(sourceRow.id));
    }

    // T-SQL merge semantics: unique by (sequence, role, content, createdAt)
    const upperCaseNormalized = (s: string) => s.trim().toUpperCase();
    const lowerCaseTrimmed = (s: string) => s.trim().toLowerCase();

    // Fetch target messages first
    const [targetSession] = await db
      .select({ id: chatSessions.id, lastMsgAt: chatSessions.lastMsgAt })
      .from(chatSessions)
      .where(eq(chatSessions.id, targetId));

    const targetMessages = await db
      .select({
        sequence: chatMessages.sequence,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, targetId))
      .orderBy(chatMessages.sequence);

    const existingContentKeys = new Set<string>();
    for (const m of targetMessages) {
      const k = `${m.sequence}:${m.createdAt}:${upperCaseNormalized(m.content)}`;
      existingContentKeys.add(k);
    }

    let totalInserted = 0;
    for (const sourceId of sourceIds) {
      const sourceMessages = await db
        .select({
          sequence: chatMessages.sequence,
          role: chatMessages.role,
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sourceId))
        .orderBy(chatMessages.sequence);

      for (const m of sourceMessages) {
        const k = `${m.sequence}:${m.createdAt}:${upperCaseNormalized(m.content)}`;
        // Validate strict uniqueness and use T-SQL semantics: NOT EXISTS with lowered, trimmed content
        const normalizedContent = lowerCaseTrimmed(m.content);
        if (!existingContentKeys.has(k)) {
          await db.insert(chatMessages).values({
            tenantId: c.get('tenantId'),
            sessionId: targetId,
            role: m.role,
            content: m.content,
            seq: m.sequence,
          });
          totalInserted++;
          existingContentKeys.add(k);
        }
      }
    }

    // Update target stats
    await db
      .update(chatSessions)
      .set({ msgCount: targetSession.msgCount + totalInserted, lastMsgAt: new Date() })
      .where(eq(chatSessions.id, targetId));

    return c.json({
      success: true,
      targetSessionId: targetId,
      sourceSessionIds: sourceIds,
      totalMessagesMerged: totalInserted,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

// ----------------------------------------------------------------------
// POST /api/brain/sessions/{target}/consolidate — merge given upstream sources into target
// ----------------------------------------------------------------------
router.post('/brain/sessions/:target/consolidate', authMiddleware as never, async (c) => {
  const db = c.get('db');
  const targetId = c.req.param('target');
  if (!targetId || targetId.includes('/')) {
    return c.json({ error: 'invalid targetId' }, 400);
  }
  const [targetRow] = await db
    .select({ id: chatSessions.id, msgCount: chatSessions.msgCount })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, Number(targetId)), eq(chatSessions.tenantId, c.get('tenantId'))));
  if (!targetRow) {
    return c.json({ error: 'target session not found' }, 404);
  }

  let payload: { sourceRefs: string[]; assignedUserId?: string; notes?: string };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!Array.isArray(payload.sourceRefs) || payload.sourceRefs.length === 0) {
    return c.json({ error: 'sourceRefs is required and must be a non-empty array' }, 400);
  }
  if (payload.sourceRefs.length > 200) {
    return c.json({ error: 'sourceRefs length must be ≤ 200' }, 400);
  }

  // Validate each source session exists
  const sourceIds: number[] = [];
  for (const ref of payload.sourceRefs) {
    const [sourceRow] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.sessionKey, ref), eq(chatSessions.tenantId, c.get('tenantId'))));
    if (!sourceRow) {
      return c.json({ error: `sourceRef not found: ${ref}` }, 404);
    }
    sourceIds.push(Number(sourceRow.id));
  }

  // T-SQL merge semantics: unique by (sequence, role, content, createdAt)
  const upperCaseNormalized = (s: string) => s.trim().toUpperCase();
  const lowerCaseTrimmed = (s: string) => s.trim().toLowerCase();

  // Fetch target messages first
  const [targetSession] = await db
    .select({ id: chatSessions.id, lastMsgAt: chatSessions.lastMsgAt })
    .from(chatSessions)
    .where(eq(chatSessions.id, targetId));

  const targetMessages = await db
    .select({
      sequence: chatMessages.sequence,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, targetId))
    .orderBy(chatMessages.sequence);

  const existingContentKeys = new Set<string>();
  for (const m of targetMessages) {
    const k = `${m.sequence}:${m.createdAt}:${upperCaseNormalized(m.content)}`;
    existingContentKeys.add(k);
  }

  let totalInserted = 0;
  for (const sourceId of sourceIds) {
    const sourceMessages = await db
      .select({
        sequence: chatMessages.sequence,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sourceId))
      .orderBy(chatMessages.sequence);

    for (const m of sourceMessages) {
      const k = `${m.sequence}:${m.createdAt}:${upperCaseNormalized(m.content)}`;
      // Validate strict uniqueness: NOT EXISTS matching (sequence, role, content, createdAt)
      const normalizedContent = lowerCaseTrimmed(m.content);
      if (!existingContentKeys.has(k)) {
        await db.insert(chatMessages).values({
          tenantId: c.get('tenantId'),
          sessionId: targetId,
          role: m.role,
          content: m.content,
          seq: m.sequence,
        });
        totalInserted++;
        existingContentKeys.add(k);
      }
    }
  }

  // Update target stats
  await db
    .update(chatSessions)
    .set({ msgCount: targetSession.msgCount + totalInserted, lastMsgAt: new Date() })
    .where(eq(chatSessions.id, targetId));

  return c.json({
    success: true,
    targetSessionId: targetId,
    sourceSessionIds: sourceIds,
    totalMessagesMerged: totalInserted,
    timestamp: new Date().toISOString(),
  });
});

  return router;
}
