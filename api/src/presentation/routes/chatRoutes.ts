/**
 * Chat consolidation route
 *
 * POST /api/brain/sessions/:target/consolidate — merge given upstream sources into target
 * This endpoint validates the target and source chats against brainChats/brainChatMessages,
 * enforces ownership/visibility using ChatTicketService, and calls ChatTicketService.consolidate
 * (which internally forwards to builtin_chats_consolidate tooling).
 */
import { Hono } from 'hono';
import { eq, and, desc, count } from 'drizzle-orm';
import { chatTicketLinks, brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import authMiddleware from '../middleware/authMiddleware';
import { ChatTicketService } from '../../application/brain/ChatTicketService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createChatRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/brain/sessions/:target/consolidate', authMiddleware, async (c) => {
    const db = c.get('db') as Db;
    const env = c.get('env') as HonoEnv;
    const tenantId = c.get('tenantId') as number;

    const targetIdParam = c.req.param('target');
    if (!targetIdParam || targetIdParam.includes('/')) {
      return c.json({ error: 'invalid targetId' }, 400);
    }

    let targetId: number;
    try {
      targetId = Number(targetIdParam);
    } catch {
      return c.json({ error: 'targetId must be a number' }, 400);
    }

    const [targetRow] = await db
      .select({ id: brainChats.id })
      .from(brainChats)
      .where(eq(brainChats.id, targetId));
    if (!targetRow) {
      return c.json({ error: 'target chat not found' }, 404);
    }

    let payload: { sourceRefs: string[] };
    try {
      payload = (await c.req.json()) as { sourceRefs: string[] };
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    if (!Array.isArray(payload.sourceRefs) || payload.sourceRefs.length === 0) {
      return c.json({ error: 'sourceRefs is required and must be a non-empty array' }, 400);
    }
    if (payload.sourceRefs.length > 200) {
      return c.json({ error: 'sourceRefs length must be ≤ 200' }, 400);
    }

    const ticketService = new ChatTicketService(db, env);
    const sourceIds: number[] = [];
    const sources = new Set<string>();

    for (const sourceRef of payload.sourceRefs) {
      const parts = sourceRef.split(':');
      if (parts.length !== 2 || isNaN(Number(parts[1]))) {
        return c.json({ error: `sourceRef must be in format 'kind:id' (e.g., 'chat:123'), got: ${sourceRef}` }, 400);
      }
      const [sourceRow] = await db
        .select({ id: brainChats.id })
        .from(brainChats)
        .where(eq(brainChats.id, Number(parts[1])));
      if (!sourceRow) {
        return c.json({ error: `chat not found for id: ${parts[1]}` }, 404);
      }
      sourceIds.push(Number(parts[1]));
      sources.add(sourceRef);
    }

    const userId = c.get('userId') as string | null;

    // Debug: log to stdout (optional)
    // console.log(`[consolidate] tenant:${tenantId} target:${targetId} sources:${sourceIds.join(',')}`);

    const result = await ticketService.consolidate(tenantId, userId, {
      targetChatId: targetId,
      sourceChatIds: sourceIds,
    });

    if ('error' in result) {
      /* map ChatTicketService.consolidate errors to HTTP codes */
      const err = result.error as string;
      if (err.includes('target chat not found')) return c.json({ error: 'target chat not found' }, 404);
      if (err.includes('no source chats to merge')) return c.json({ error: 'no source chats to merge' }, 400);

      return c.json({ error: `consolidation failed: ${err}` }, 500);
    }

    // Pull mergedIntoChatId for each source to comply with schema contract
    const [overviewRows] = await db
      .select({ id: brainChats.id, mergedIntoChatId: brainChats.mergedIntoChatId, title: brainChats.title })
      .from(brainChats)
      .where(eq(brainChats.tenantId, tenantId))
      .andWhere(eq(brainChats.mergedIntoChatId, targetId));

    const [targetRowInfo] = await db.select({ id: brainChats.id, title: brainChats.title }).from(brainChats).where(eq(brainChats.id, targetId));

    const consolidatedSources = overviewRows?.map((r) => ({ chatId: r.id, title: r.title, mergedIntoChatId: r.mergedIntoChatId })) || [];

    return c.json({
      success: true,
      targetSessionId: targetId,
      targetTitle: targetRowInfo?.title || 'unknown',
      sourceSessionIds: sourceIds,
      consolidatedSources,
      totalMessagesMerged: result.messagesMoved,
      linksMoved: result.linksMoved,
      timestamp: new Date().toISOString(),
    });
  });

  // List consolidated chats in branched view for this tenant
  router.get('/brain/sessions/consolidated', authMiddleware as never, async (c) => {
    const db = c.get('db') as Db;
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const rows = await db
      .select({
        id: brainChats.id,
        title: brainChats.title,
        projectId: brainChats.projectId,
        isArchived: brainChats.isArchived,
        mergedIntoChatId: brainChats.mergedIntoChatId,
        createdAt: brainChats.createdAt,
        updatedAt: brainChats.updatedAt,
      })
      .from(brainChats)
      .where(eq(brainChats.tenantId, tenantId))
      .orderBy(desc(brainChats.updatedAt))
      .limit(limit)
      .offset(offset);

    return c.json({ sessions: rows });
  });

  return router;
}