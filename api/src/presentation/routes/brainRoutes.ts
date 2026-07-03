/**
 * Brain chat routes — thin presentation layer.
 *
 * All business logic lives in BrainService.
 * This file maps HTTP request/response to service calls.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { signUpload } from '../../infrastructure/auth/uploadSign';
import { fetchWebDocument } from '../../application/web/webFetch';
import { recordOutboundFetch, enforceOutboundFetchCap } from '../../application/web/outboundFetchLedger';
import { agentHosts } from '../../infrastructure/database/schema';
import { ChatTicketService } from '../../application/brain/ChatTicketService';
import type { Env, HonoEnv } from '../../env';
import type { BrainService } from '../../application/brain/BrainService';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a numeric :id param, returning NaN-safe result or a 400 response. */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createBrainRoutes(brainService: BrainService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

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
    const body = await c.req.json<{ title?: string; projectId?: number | null }>();
    const result = await brainService.createChat({
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      title: body.title,
      projectId: body.projectId,
    });
    if (result && 'error' in result) return c.json({ error: result.error }, 404);
    return c.json(result, 201);
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

    const body = await c.req.json<{ title?: string; projectId?: number | null }>();
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

  // POST /chats/:id/messages
  router.post('/chats/:id/messages', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid chat id' }, 400);

    const body = await c.req.json<{ messages: Array<{ role: string; content: string; metadata?: string }> }>();
    const result = await brainService.appendMessages(
      id,
      c.get('tenantId') as number,
      c.get('userId') as string,
      body,
    );
    if ('error' in result) {
      const status = result.error === 'Chat not found' ? 404 : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json({ messages: result }, 201);
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
      apiKey,
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

    const cap = await enforceOutboundFetchCap(db, tenantId);
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
      apiKey,
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
      apiKey,
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
    if (!key || !key.startsWith(`${tenantId}/`)) {
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
    if (!key.startsWith(`${tenantId}/`)) {
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
