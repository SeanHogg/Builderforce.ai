/**
 * Brain chat routes — thin presentation layer.
 *
 * All business logic lives in BrainService.
 * This file maps HTTP request/response to service calls.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { coderclawInstances } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { BrainService } from '../../application/brain/BrainService';
import type { Db } from '../../infrastructure/database/connection';
import type { ClawRelayDO } from '../../infrastructure/relay/ClawRelayDO';

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

  // POST /claw-sessions/:id/summarize — summarize a claw chat session into brain memory
  router.post('/claw-sessions/:id/summarize', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid session id' }, 400);

    const apiKey = c.env.OPENROUTER_API_KEY;
    if (!apiKey) return c.json({ error: 'LLM not configured' }, 503);

    const result = await brainService.summarizeClawSession(
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
    ];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: `File type ${file.type} not allowed` }, 400);
    }

    const ext = file.name.split('.').pop() ?? 'bin';
    const key = `${tenantId}/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

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

  // POST /projects/:id/memory-sync — push consolidated project memory to all tenant claws
  router.post('/projects/:id/memory-sync', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'Invalid project id' }, 400);

    const tenantId = c.get('tenantId') as number;
    const env = c.env as { CLAW_RELAY?: DurableObjectNamespace<ClawRelayDO> };
    if (!env.CLAW_RELAY) return c.json({ error: 'Relay not configured' }, 503);

    // Get the consolidated project memory
    const memory = await brainService.getProjectMemory(tenantId, id);
    if (!memory?.consolidatedSummary) {
      return c.json({ error: 'No consolidated memory to sync' }, 404);
    }

    // Find all claws in this tenant
    const claws = await db
      .select({ id: coderclawInstances.id })
      .from(coderclawInstances)
      .where(eq(coderclawInstances.tenantId, tenantId));

    // Dispatch memory.sync to each claw via relay DO
    const payload = {
      type: 'memory.sync',
      projectId: id,
      content: memory.consolidatedSummary,
      path: `.coderClaw/project-memory-${id}.md`,
    };

    let dispatched = 0;
    for (const claw of claws) {
      try {
        const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(claw.id)));
        const res = await stub.fetch(new Request('https://do/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }));
        if (res.ok) dispatched++;
      } catch { /* swallow — claw may be offline */ }
    }

    return c.json({ ok: true, dispatched, total: claws.length });
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
