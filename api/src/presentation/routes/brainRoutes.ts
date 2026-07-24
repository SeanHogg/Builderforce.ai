/**
 * Brain chat routes — thin presentation layer.
 *
 * All business logic lives in BrainService.
 * This file maps HTTP request/response to service calls.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { signUpload } from '../../infrastructure/auth/uploadSign';
import { fetchWebDocument } from '../../application/web/webFetch';
import { recordOutboundFetch, enforceOutboundFetchCap } from '../../application/web/outboundFetchLedger';
import { agentHosts, users, chatTicketLinks } from '../../infrastructure/database/schema';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';
import { ChatTicketService } from '../../application/brain/ChatTicketService';
import { bumpCacheVersion, getCacheVersion, getOrSetCached, ticketSearchVersionKey } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { sendChatInviteEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../../application/email/sendEmail';
import { headerHints } from '../../application/email/emailLocaleResolver';
import { isKeyOwnedByTenant } from '../../domain/shared/r2Keys';
import type { Env, HonoEnv } from '../../env';
import type { BrainService, BrainTraceEventInput } from '../../application/brain/BrainService';
import { learnFromPersistedTurns } from '../../application/brain/brainEvermindLearning';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { brainChatRoomName } from '../../infrastructure/relay/broadcastRoom';
import { relayToRoom } from './realtimeRelay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a numeric :id param, returning NaN-safe result or a 400 response. */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/** Per-chat version token for the cached trace read — bumped on every append so
 *  the next GET /chats/:id/trace re-loads (the trace keyspace folds this token in). */
const traceVersionKey = (chatId: number): string => `brain-trace-version:chat:${chatId}`;

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createBrainRoutes(brainService: BrainService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // One authenticated invalidation channel per chat. The relay carries no domain
  // data; clients re-read the durable transcript after a `changed` frame.
  router.get('/chats/:id/stream', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const allowed = await brainService.canAccess(id, c.get('tenantId'), c.get('userId'));
    if (!allowed) return c.json({ error: 'Chat not found' }, 404);
    return relayToRoom(c, c.env?.SESSION_ROOM, brainChatRoomName(c.get('tenantId'), id));
  });

  // GET /chats
  router.get('/chats', async (c) => {
    const rows = await brainService.listChats(
      c.get('tenantId') as number,
      c.get('userId') as string,
      {
        projectId: c.req.query('projectId'),
        limit: Number(c.req.query('limit') ?? 50),
        offset: Number(c.req.query('offset') ?? 0),
      },
    );
    return c.json({ chats: rows });
  });

  // POST /chats
  router.post('/chats', async (c) => {
    const body = await c.req.json<{ title?: string; projectId?: number | null; capability?: string | null }>();
    const result = await brainService.createChat({
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      title: body.title,
      projectId: body.projectId,
      capability: body.capability,
    });
    if (result && 'error' in result) return c.json({ error: result.error }, 404);
    return c.json(result, 201);
  });

  // GET /team-chat?projectId=&teamId=  — resolve-or-create the canonical TEAM chat
  // for a scope: a project (projectId), a named workforce team (teamId), or — both
  // omitted — the tenant-wide "broader team". The chat icon on the Project, Team, and
  // Workforce surfaces hits this, then opens the returned chat id through the normal
  // /chats/:id/messages endpoints. Idempotent: everyone lands in the SAME conversation.
  router.get('/team-chat', async (c) => {
    const rawProject = c.req.query('projectId');
    const rawTeam = c.req.query('teamId');
    const projectId = rawProject != null && rawProject !== '' && rawProject !== 'none' ? parseId(rawProject) : null;
    const teamId = rawTeam != null && rawTeam !== '' && rawTeam !== 'none' ? parseId(rawTeam) : null;
    if (rawProject != null && rawProject !== '' && rawProject !== 'none' && projectId == null) {
      return c.json({ error: 'Invalid project id' }, 400);
    }
    if (rawTeam != null && rawTeam !== '' && rawTeam !== 'none' && teamId == null) {
      return c.json({ error: 'Invalid team id' }, 400);
    }
    const result = await brainService.getOrCreateTeamChat(
      c.get('tenantId') as number,
      c.get('userId') as string,
      { projectId, teamId },
    );
    if ('error' in result) {
      const notFound = result.error === 'Project not found in tenant' || result.error === 'Team not found in tenant';
      return c.json({ error: result.error }, notFound ? 404 : 400);
    }
    return c.json(result);
  });

  // GET /chats/:id
  router.get('/chats/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const chat = await brainService.getChat(id, c.get('tenantId') as number, c.get('userId') as string);
    if (!chat) return c.json({ error: 'Chat not found' }, 404);
    return c.json(chat);
  });

  // PATCH /chats/:id
  router.patch('/chats/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const body = await c.req.json<{ title?: string; projectId?: number | null; visibility?: 'shared' | 'locked'; capability?: string | null }>();
    const result = await brainService.updateChat(
      id,
      c.get('tenantId') as number,
      c.get('userId') as string,
      body,
    );
    if (result && 'error' in result) {
      const status = result.error === 'Chat not found' ? 404 : 404;
      return c.json({ error: result.error }, status);
    }
    return c.json(result);
  });

  // DELETE /chats/:id
  router.delete('/chats/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const result = await brainService.archiveChat(id, c.get('tenantId') as number, c.get('userId') as string);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // GET /chats/:id/messages
  router.get('/chats/:id/messages', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const limit = Number(c.req.query('limit') ?? 100);
    const result = await brainService.getMessages(id, c.get('tenantId') as number, c.get('userId') as string, limit);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json({ messages: result });
  });

  // POST /chats/:id/read — advance the caller's unread high-water mark. Body
  // `{ seq? }`; seq omitted marks everything read. Fired when a chat is opened
  // (mounted) on EITHER surface, so an execution milestone landing in a chat the
  // user is not viewing shows an unread badge until they read it — and reading it
  // on one surface clears it on the other (one unified conversation).
  router.post('/chats/:id/read', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const body = await c.req.json<{ seq?: number }>().catch(() => ({} as { seq?: number }));
    const result = await brainService.markRead(
      id, c.get('tenantId') as number, c.get('userId') as string,
      typeof body.seq === 'number' ? body.seq : undefined,
    );
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // POST /chats/:id/messages
  router.post('/chats/:id/messages', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const body = await c.req.json<{ messages: Array<{ role: string; content: string; metadata?: string }> }>();
    const tenantId = c.get('tenantId') as number;
    const result = await brainService.appendMessages(
      id,
      tenantId,
      c.get('userId') as string,
      body,
    );
    if ('error' in result) {
      const status = result.error === 'Chat not found' ? 404 : 400;
      return c.json({ error: result.error }, status);
    }

    // A human posting into a chat that's linked to a ticket IS a comment on that
    // ticket — surface it on the unified activity/audit log (verb `comment.added`),
    // fanned to each linked ticket. Off the response path; best-effort.
    const userText = (body.messages ?? []).filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
    if (userText.length > 0) {
      c.executionCtx.waitUntil((async () => {
        const links = await db.select({ kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef })
          .from(chatTicketLinks)
          .where(and(eq(chatTicketLinks.chatId, id), eq(chatTicketLinks.tenantId, tenantId)))
          .catch(() => [] as Array<{ kind: string; ref: string }>);
        if (!links.length) return;
        const actor = await resolveActorFromContext(c.env as Env, db, c);
        const summary = userText[userText.length - 1]!.content.replace(/\s+/g, ' ').trim().slice(0, 200);
        for (const l of links) {
          await recordActivity(c.env as Env, db, {
            tenantId, actor, verb: 'comment.added',
            targetType: l.kind, targetId: l.ref, summary, metadata: { chatId: id },
          }).catch(() => {});
        }
      })());
    }

    // Notify any HUMAN addressed in these turns (directed @human message) so an
    // offline teammate learns they were pinged — in-app + optional email.
    const mentioned = new Set<string>();
    for (const m of body.messages ?? []) {
      if (!m.metadata) continue;
      try {
        const a = (JSON.parse(m.metadata) as { addressedTo?: { kind?: string; ref?: string } }).addressedTo;
        if (a?.kind === 'human' && a.ref) mentioned.add(a.ref);
      } catch { /* not directed */ }
    }
    if (mentioned.size > 0) {
      c.executionCtx.waitUntil((async () => {
        for (const uid of mentioned) {
          try {
            await notify(neon((c.env as Env).NEON_DATABASE_URL), c.env as Env, {
              userId: uid, tenantId, kind: 'chat_mention',
              title: 'You were mentioned in a chat',
              body: 'A teammate addressed you in a Builderforce chat.',
              ref: String(id),
            });
          } catch { /* best-effort */ }
        }
      })());
    }

    // Train the project's Evermind FROM this conversation (not just agent runs): a
    // persisted assistant turn in a project chat whose Evermind is seeded + connected
    // is contributed to learning. ONE learn-on-persist entry point (shared with the
    // `@agent` reply path) evaluates the gate synchronously (a cached head read) so the
    // response reports the TRUTHFUL outcome — the client renders its `learn` step off
    // this — and dispatches the slow coordinator contribution in the background.
    const evermindLearn = await learnFromPersistedTurns(
      c.env as Env, db, id, tenantId, result, (p) => c.executionCtx.waitUntil(p),
    );

    return c.json({ messages: result, evermindLearn }, 201);
  });

  // GET /chats/:id/trace — the persisted tool/LLM-turn timeline (survives reload).
  // Cached read-through, keyed by a per-chat version token bumped on every append.
  router.get('/chats/:id/trace', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    if (!(await brainService.canAccess(id, tenantId, userId))) return c.json({ error: 'Chat not found' }, 404);

    const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 500)), 2000);
    const token = await getCacheVersion(c.env as Env, traceVersionKey(id));
    const key = `brain-trace:chat:${id}:v:${token}:l:${limit}`;
    const trace = await getOrSetCached(c.env as Env, key, () => brainService.getTrace(id, limit));
    return c.json({ trace });
  });

  // POST /chats/:id/trace — persist tool-turn trace events for this chat.
  router.post('/chats/:id/trace', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    if (!(await brainService.canAccess(id, tenantId, userId))) return c.json({ error: 'Chat not found' }, 404);

    const body = await c.req.json<{ events?: BrainTraceEventInput[] }>().catch(() => ({} as { events?: BrainTraceEventInput[] }));
    const result = await brainService.appendTrace(id, body.events ?? []);
    // Invalidate the cached read so the next GET reflects these events.
    await bumpCacheVersion(c.env as Env, traceVersionKey(id)).catch(() => {});
    return c.json(result, 201);
  });

  // POST /chats/:id/summarize
  router.post('/chats/:id/summarize', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'LLM not configured' }, 503);

    const result = await brainService.summarizeChat(
      id,
      c.get('tenantId') as number,
      c.get('userId') as string,
      c.env,
    );
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // Chat ↔ ticket links, lineage, consolidation, agent invites
  // A chat can be tied to work items of any tier (portfolio | objective | OKR |
  // initiative | epic | task), MANY-to-MANY, with a health (% done) summary and
  // chat↔ticket lineage. Logic lives in ChatTicketService (shared with the MCP
  // tools). Instantiated per-request because it needs the worker env (cache +
  // agent-assignment reads).
  // -------------------------------------------------------------------------

  // GET /chats/:id/tickets — the tickets this chat is tied to, each with health.
  router.get('/chats/:id/tickets', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.listTicketsForChat(c.get('tenantId') as number, id, c.get('userId') as string);
    if (!Array.isArray(result) && 'error' in result) return c.json({ error: result.error }, 404);
    return c.json({ tickets: result });
  });

  // POST /chats/:id/tickets — link this chat to a ticket. { kind, ref, linkType? }
  router.post('/chats/:id/tickets', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const body = await c.req.json<{ kind?: string; ref?: string | number; linkType?: 'linked' | 'created' }>().catch(() => ({} as { kind?: string; ref?: string | number; linkType?: 'linked' | 'created' }));
    if (!body.kind || body.ref == null) return c.json({ error: 'kind and ref are required' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.linkTicket(c.get('tenantId') as number, id, c.get('userId') as string, {
      kind: String(body.kind), ref: String(body.ref), linkType: body.linkType,
    });
    if ('error' in result) return c.json({ error: result.error }, result.error === 'Chat not found' ? 404 : 400);
    return c.json(result, 201);
  });

  // DELETE /chats/:id/tickets?kind=&ref= — remove a chat↔ticket link.
  router.delete('/chats/:id/tickets', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const kind = c.req.query('kind');
    const ref = c.req.query('ref');
    if (!kind || !ref) return c.json({ error: 'kind and ref are required' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.unlinkTicket(c.get('tenantId') as number, id, c.get('userId') as string, kind, ref);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // GET /tickets/search?kind=&q=&project_id=&limit= — server-side typeahead for the
  // link picker. Replaces the old "load every ticket into the browser then filter"
  // (heavy AND incomplete past a list endpoint's 200-row cap). Version-token cached
  // (unbounded query keyspace) with a short TTL backstop; the token bumps on ticket writes.
  router.get('/tickets/search', async (c) => {
    const env = c.env as Env;
    const tenantId = c.get('tenantId') as number;
    const kind = c.req.query('kind') ?? '';
    const q = (c.req.query('q') ?? '').slice(0, 200);
    const projRaw = c.req.query('project_id');
    const projectId = projRaw != null && projRaw !== '' ? Number(projRaw) : null;
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 40) || 40, 1), 50);
    if (projectId != null && Number.isNaN(projectId)) return c.json({ error: 'Invalid project_id' }, 400);

    const version = await getCacheVersion(env, ticketSearchVersionKey(tenantId));
    const key = `tickets:search:t:${tenantId}:p:${projectId ?? 'all'}:k:${kind}:l:${limit}:q:${q.trim().toLowerCase()}:v:${version}`;
    const results = await getOrSetCached(
      env,
      key,
      () => new ChatTicketService(db, env).searchTickets(tenantId, kind, q, projectId, limit),
      { kvTtlSeconds: 45 },
    );
    return c.json({ results });
  });

  // GET /tickets/:kind/:ref/chats — lineage: every chat that references a ticket
  // (which conversations shaped it, and which SPAWNED it via linkType='created').
  router.get('/tickets/:kind/:ref/chats', async (c) => {
    const svc = new ChatTicketService(db, c.env as Env);
    const rows = await svc.listChatsForTicket(c.get('tenantId') as number, c.req.param('kind'), c.req.param('ref'));
    return c.json({ chats: rows });
  });

  // POST /chats/consolidate — merge source chats into a target (archive+redirect).
  router.post('/chats/consolidate', async (c) => {
    const body = await c.req.json<{ targetChatId?: number; sourceChatIds?: number[] }>().catch(() => ({} as { targetChatId?: number; sourceChatIds?: number[] }));
    if (!body.targetChatId || !Array.isArray(body.sourceChatIds) || body.sourceChatIds.length === 0) {
      return c.json({ error: 'targetChatId and a non-empty sourceChatIds are required' }, 400);
    }
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.consolidate(c.get('tenantId') as number, c.get('userId') as string, {
      targetChatId: Number(body.targetChatId), sourceChatIds: body.sourceChatIds.map(Number),
    });
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  });

  // GET /chats/:id/agents — agents invited into this chat.
  router.get('/chats/:id/agents', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.listAgents(c.get('tenantId') as number, id, c.get('userId') as string);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json({ agents: result });
  });

  // POST /chats/:id/agents — invite an agent into this chat. { agentRef, agentKind?, role? }
  router.post('/chats/:id/agents', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const body = await c.req.json<{ agentRef?: string; agentKind?: string; role?: string }>().catch(() => ({} as { agentRef?: string; agentKind?: string; role?: string }));
    if (!body.agentRef) return c.json({ error: 'agentRef is required' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.inviteAgent(c.get('tenantId') as number, id, c.get('userId') as string, {
      agentRef: String(body.agentRef), agentKind: body.agentKind, role: body.role,
    });
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result, 201);
  });

  // DELETE /chats/:id/agents/:assignmentId — remove an agent from this chat.
  router.delete('/chats/:id/agents/:assignmentId', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const svc = new ChatTicketService(db, c.env as Env);
    const result = await svc.removeAgent(c.get('tenantId') as number, id, c.get('userId') as string, c.req.param('assignmentId'));
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // Human members (shared access + invite, migration 0288). A chat is global to
  // its project+tenant; these endpoints manage the human roster (the audience)
  // and invite teammates who then collaborate. Delivery goes through the shared
  // notify() (in-app + optional email) for existing users, or a chat-invite email
  // for a not-yet-account address (converts on their next access).
  // -------------------------------------------------------------------------

  // GET /chats/:id/members — human participants of this chat.
  router.get('/chats/:id/members', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const result = await brainService.listMembers(id, c.get('tenantId') as number, c.get('userId') as string);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json({ members: result });
  });

  // POST /chats/:id/members — invite a human by email (owner only). { email }
  router.post('/chats/:id/members', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
    if (!body.email) return c.json({ error: 'email is required' }, 400);

    const result = await brainService.inviteHuman(id, tenantId, userId, { email: String(body.email) });
    if ('error' in result) return c.json({ error: result.error }, result.error === 'Chat not found' ? 404 : 400);

    // Deliver the invite (best-effort — never fails the invite itself).
    if (!result.already) {
      c.executionCtx.waitUntil((async () => {
        try {
          const [inviter] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
          const inviterName = inviter?.name || inviter?.email || 'A teammate';
          const appUrl = (c.env as { APP_URL?: string }).APP_URL || 'https://builderforce.ai';
          const chatUrl = `${appUrl}/ide/dashboard?chat=${id}`;
          if (result.status === 'active' && result.memberUserId) {
            await notify(neon((c.env as Env).NEON_DATABASE_URL), c.env as Env, {
              userId: result.memberUserId, tenantId, kind: 'chat_invite',
              title: `${inviterName} invited you to a chat`,
              body: `You've been added to "${result.chatTitle}". Open Builderforce to join the conversation.`,
              ref: String(id),
            });
          } else {
            // Same locale rule as the workspace invite: the invitee's own stored
            // locale when they have an account, otherwise the inviter's request locale.
            await sendTransactionalEmail(
              c.env as Env,
              db,
              result.email,
              ({ locale }) => sendChatInviteEmail(c.env as Env, result.email, {
                chatTitle: result.chatTitle, inviterName, chatUrl, locale,
              }),
              { headers: headerHints(c.req) },
            );
          }
        } catch { /* delivery is best-effort */ }
      })());
    }
    return c.json(result, 201);
  });

  // DELETE /chats/:id/members/:memberId — remove a human member (owner only).
  router.delete('/chats/:id/members/:memberId', async (c) => {
    const id = parseId(c.req.param('id'));
    const memberId = parseId(c.req.param('memberId'));
    if (!id || !memberId) return c.json({ error: 'Invalid id' }, 400);
    const result = await brainService.removeMember(id, c.get('tenantId') as number, c.get('userId') as string, memberId);
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // POST /chats/:id/agent-reply — the addressed agent answers. { agentRef, agentName? }
  // Produces a chat-scoped reply AS the invited agent, posted as an assistant turn
  // attributed to it (metadata.authoredBy). Called after a user directs a message
  // to an @agent participant.
  router.post('/chats/:id/agent-reply', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);
    const body = await c.req.json<{ agentRef?: string; agentName?: string }>().catch(() => ({} as { agentRef?: string; agentName?: string }));
    if (!body.agentRef) return c.json({ error: 'agentRef is required' }, 400);
    // The agent runs its platform-tool loop with the TRIGGERING user's role/token,
    // so it can never exceed the human's own permissions.
    const authToken = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const result = await brainService.agentReply(
      id,
      c.get('tenantId') as number,
      c.get('userId') as string,
      { agentRef: String(body.agentRef), agentName: body.agentName },
      c.env as Env,
      { role: c.get('role') as string | undefined, authToken, executionCtx: c.executionCtx },
    );
    if ('error' in result) {
      const notFound = result.error === 'Chat not found';
      return c.json({ error: result.error }, notFound ? 404 : result.error === 'LLM not configured' ? 503 : 400);
    }
    return c.json({ message: result }, 201);
  });

  // POST /fetch-url — fetch an external URL/file/website server-side (CORS-free)
  // so the Brain can read a link the user pastes (e.g. a GitHub ROADMAP.md, a
  // docs page). Behind the auth middleware + an SSRF guard; returns readable
  // text capped to keep the model's context bounded.
  //
  // Abuse controls (this is a tenant-authed but otherwise-arbitrary outbound GET
  // proxy): a per-tenant sliding-window rate limit (reuses rateLimitMiddleware)
  // caps burst, and a monthly consumption meter (outbound_fetches) caps sustained
  // volume — graceful backpressure, refused with 429 once over the allowance.
  router.post('/fetch-url', rateLimitMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const { url } = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    if (!url || typeof url !== 'string') return c.json({ error: 'A url is required' }, 400);

    const cap = await enforceOutboundFetchCap(db, tenantId, c.env as Env);
    if (!cap.allowed) {
      return c.json(
        { error: 'Monthly outbound-fetch allowance reached for your plan.', used: cap.used, limit: cap.limit },
        429,
      );
    }

    let result;
    try {
      result = await fetchWebDocument(url);
    } catch (e) {
      // SSRF rejection or unreachable origin — a 400 the model can relay.
      return c.json({ error: e instanceof Error ? e.message : 'Could not fetch the URL' }, 400);
    }
    // Meter every fetch that actually hit the wire (success OR upstream error) —
    // the outbound cost is the request, not the response. Best-effort; never fail
    // the read over a metering write.
    c.executionCtx.waitUntil(recordOutboundFetch(db, tenantId, result.url).catch(() => {}));
    if (result.status >= 400) {
      return c.json({ error: `The URL returned HTTP ${result.status}.`, url: result.url, status: result.status }, 502);
    }
    return c.json(result);
  });

  // GET /memories
  router.get('/memories', async (c) => {
    const rows = await brainService.listMemories(c.get('tenantId') as number, {
      projectId: c.req.query('projectId'),
      limit: Number(c.req.query('limit') ?? 50),
    });
    return c.json({ memories: rows });
  });

  // GET /projects/:id/memory
  router.get('/projects/:id/memory', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid project id' }, 400);

    const memory = await brainService.getProjectMemory(c.get('tenantId') as number, id);
    return c.json({ memory });
  });

  // POST /projects/:id/consolidate
  router.post('/projects/:id/consolidate', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid project id' }, 400);

    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'LLM not configured' }, 503);

    const result = await brainService.consolidateProjectMemory(
      c.get('tenantId') as number,
      id,
      c.env,
    );
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // POST /agent-host-sessions/:id/summarize — summarize an agentHost chat session into brain memory
  router.post('/agent-host-sessions/:id/summarize', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid session id' }, 400);

    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'LLM not configured' }, 503);

    const result = await brainService.summarizeAgentHostSession(
      id,
      c.get('tenantId') as number,
      c.env,
    );
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  // POST /upload — upload file to R2, returns the object URL
  router.post('/upload', async (c) => {
    const env = c.env as { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'File storage not configured' }, 503);

    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;

    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file provided' }, 400);

    // Size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 10MB)' }, 400);
    }

    // Allowed MIME types
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'text/plain', 'text/markdown', 'text/csv',
      'application/json',
      // Office OpenXML — deck templates (.pptx) to fill, plus .docx/.xlsx.
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    // Browsers sometimes send octet-stream for .pptx/.docx/.xlsx — allow by extension too.
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const allowedExts = ['pptx', 'docx', 'xlsx'];
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      return c.json({ error: `File type ${file.type} not allowed` }, 400);
    }

    const key = `${tenantId}/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext || 'bin'}`;

    await env.UPLOADS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { originalName: file.name, tenantId: String(tenantId) },
    });

    return c.json({
      key,
      name: file.name,
      type: file.type,
      size: file.size,
    }, 201);
  });

  // POST /uploads/sign — mint a short-lived signed URL for an uploaded object so
  // an upstream LLM provider can fetch it (vision) without the tenant token. Used
  // only for images too large to inline as a data URL.
  router.post('/uploads/sign', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const { key } = await c.req.json<{ key?: string }>();
    if (!isKeyOwnedByTenant(key, tenantId)) {
      return c.json({ error: 'Not found' }, 404);
    }
    const secret = (c.env as { JWT_SECRET?: string }).JWT_SECRET;
    if (!secret) return c.json({ error: 'Signing not configured' }, 503);
    const { exp, sig } = await signUpload(key, secret);
    return c.json({ exp, sig });
  });

  // GET /uploads/:key+ — serve an uploaded file from R2
  router.get('/uploads/*', async (c) => {
    const env = c.env as { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'File storage not configured' }, 503);

    const tenantId = c.get('tenantId') as number;
    const key = c.req.path.replace('/uploads/', '');

    // Scope: files must belong to this tenant
    if (!isKeyOwnedByTenant(key, tenantId)) {
      return c.json({ error: 'Not found' }, 404);
    }

    const obj = await env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Not found' }, 404);

    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { headers });
  });

  // POST /projects/:id/memory-sync — push consolidated project memory to all tenant agentHosts
  router.post('/projects/:id/memory-sync', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid project id' }, 400);

    const tenantId = c.get('tenantId') as number;
    const env = c.env as { AGENT_HOST_RELAY?: DurableObjectNamespace<AgentHostRelayDO> };
    if (!env.AGENT_HOST_RELAY) return c.json({ error: 'Relay not configured' }, 503);

    // Get the consolidated project memory
    const memory = await brainService.getProjectMemory(tenantId, id);
    if (!memory?.consolidatedSummary) {
      return c.json({ error: 'No consolidated memory to sync' }, 404);
    }

    // Find all agentHosts in this tenant
    const hostRows = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(eq(agentHosts.tenantId, tenantId));

    // Dispatch memory.sync to each agentHost via relay DO
    const payload = {
      type: 'memory.sync',
      projectId: id,
      content: memory.consolidatedSummary,
      path: `.builderforce/project-memory-${id}.md`,
    };

    let dispatched = 0;
    for (const agentHost of hostRows) {
      try {
        const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHost.id)));
        const res = await stub.fetch(new Request('https://do/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }));
        if (res.ok) dispatched++;
      } catch { /* swallow — agentHost may be offline */ }
    }

    return c.json({ ok: true, dispatched, total: hostRows.length });
  });

  // PATCH /messages/:id/feedback — store thumbs-up/down on a message
  router.patch('/messages/:id/feedback', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid message id' }, 400);

    const body = await c.req.json<{ feedback: 'up' | 'down' | null }>();
    if (body.feedback !== 'up' && body.feedback !== 'down' && body.feedback !== null) {
      return c.json({ error: 'Invalid feedback value' }, 400);
    }

    const result = await brainService.setMessageFeedback(
      id,
      c.get('tenantId') as number,
      c.get('userId') as string,
      body.feedback,
    );
    if ('error' in result) return c.json({ error: result.error }, 404);
    return c.json(result);
  });

  return router;
}
