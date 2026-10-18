/**
 * Chat persistence routes
 *
 * POST /api/agent-hosts/:agentHostId/messages  — agentHost-key auth (Bearer or ?key=); upserts session + bulk inserts messages
 * GET  /api/chats                         — JWT tenant auth; lists chat sessions across all agentHosts
 * GET  /api/chats/:sessionId/messages     — JWT tenant auth; messages for a session
 * GET  /api/agent-hosts/:agentHostId/sessions/:sessionKey/messages  — JWT tenant auth; messages by session key
 *
 * Both agent-host paths also answer at the deprecated camelCase `/api/agentHosts/…`
 * (Deprecation + successor Link), never as a second handler.
 */
import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { AGENT_HOST_BASE_PATH, legacyAliasNotice } from '../middleware/legacyAlias';
import {
  authenticateChatHost,
  listChatMessagesBySessionKey,
  listChatSessionMessages,
  listTenantChatSessions,
  persistHostChatMessages,
} from '../../application/agentHost/hostChatSessions';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { limitParam, offsetParam } from './queryParams';
import { parseBody, z, zNonEmptyString, zPositiveInt } from './requestBody';

/** What the relay DO persists: a session key plus the messages seen since last flush. */
const PersistMessagesBody = z.object({
  sessionKey: zNonEmptyString,
  projectId: zPositiveInt.optional(),
  messages: z.array(z.object({
    role: zNonEmptyString,
    content: z.string(),
    metadata: z.string().nullable().optional(),
    seq: z.number().int(),
  })).optional(),
});

export function createChatRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ---------------------------------------------------------------------------
  // POST /api/agent-hosts/:agentHostId/messages?key=<agentHostApiKey>
  // Relay DO calls this to persist messages. Creates/upserts the session row
  // and bulk-inserts messages. Authentication via the agentHost's own API key.
  // ---------------------------------------------------------------------------
  const persistMessages = async (c: Context<HonoEnv>) => {
    const agentHostId = Number(c.req.param('agentHostId'));
    // The relay DO sends the host key as a Bearer (like every other host ingest); the
    // legacy `?key=` stays accepted.
    const key = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.query('key');

    if (Number.isNaN(agentHostId) || agentHostId <= 0) {
      return c.json({ error: 'invalid agentHostId' }, 400);
    }

    const agentHost = await authenticateChatHost(db, agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const { sessionKey, projectId, messages } = await parseBody(c, PersistMessagesBody);
    if (!messages || messages.length === 0) {
      return c.json({ ok: true, inserted: 0 });
    }

    const { inserted, sessionId } = await persistHostChatMessages(db, agentHost, { sessionKey, projectId, messages });
    return c.json({ ok: true, inserted, sessionId });
  };
  // The canonical agent-host base path — where the relay DO's `callApi` posts. Without
  // it every relayed chat message 404'd and was never persisted.
  router.post('/agent-hosts/:agentHostId/messages', persistMessages);
  // Pre-rebrand camelCase spelling, kept for already-deployed hosts.
  router.post('/agentHosts/:agentHostId/messages', camelCaseAlias('messages'), persistMessages);

  // ---------------------------------------------------------------------------
  // GET /api/chats?limit=&offset=   — tenant JWT; all sessions across all agentHosts
  // ---------------------------------------------------------------------------
  router.get('/chats', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit  = limitParam(c.req.query('limit'), 50, 100);
    const offset = offsetParam(c.req.query('offset'));

    const rows = await listTenantChatSessions(db, tenantId, { limit, offset });

    return c.json({ sessions: rows });
  });

  // ---------------------------------------------------------------------------
  // GET /api/chats/:sessionId/messages?limit=   — tenant JWT; messages for session
  // ---------------------------------------------------------------------------
  router.get('/chats/:sessionId/messages', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const sessionId = Number(c.req.param('sessionId'));
    const limit = limitParam(c.req.query('limit'), 100, 200);

    if (Number.isNaN(sessionId)) return c.json({ error: 'invalid sessionId' }, 400);

    // null = the session is not this tenant's.
    const msgs = await listChatSessionMessages(db, tenantId, sessionId, limit);
    if (!msgs) return c.json({ error: 'not found' }, 404);

    return c.json({ messages: msgs });
  });

  // ---------------------------------------------------------------------------
  // GET /api/agent-hosts/:agentHostId/sessions/:sessionKey/messages?limit=   — JWT auth
  // Browser client fetches history for the active session by key.
  // ---------------------------------------------------------------------------
  const sessionMessagesByKey = async (c: Context<HonoEnv>) => {
    const tenantId  = c.get('tenantId') as number;
    const agentHostId    = Number(c.req.param('agentHostId'));
    const sessionKey = c.req.param('sessionKey');
    const limit = limitParam(c.req.query('limit'), 50, 200);

    if (Number.isNaN(agentHostId) || !sessionKey) {
      return c.json({ error: 'invalid params' }, 400);
    }

    const msgs = await listChatMessagesBySessionKey(db, tenantId, agentHostId, sessionKey, limit);
    return c.json({ messages: msgs });
  };
  router.get('/agent-hosts/:agentHostId/sessions/:sessionKey/messages', authMiddleware, sessionMessagesByKey);
  router.get(
    '/agentHosts/:agentHostId/sessions/:sessionKey/messages',
    camelCaseAlias((c) => `sessions/${encodeURIComponent(c.req.param('sessionKey') ?? '')}/messages`),
    authMiddleware,
    sessionMessagesByKey,
  );

  return router;
}

/**
 * `/api/agentHosts/:id/...` is the camelCase twin of the canonical kebab
 * `/api/agent-hosts/:id/...`: same handler, stamped deprecated with the concrete successor.
 */
function camelCaseAlias(suffix: string | ((c: Context<HonoEnv>) => string)) {
  return legacyAliasNotice((c) => {
    const tail = typeof suffix === 'string' ? suffix : suffix(c);
    return `${AGENT_HOST_BASE_PATH}/${c.req.param('agentHostId')}/${tail}`;
  });
}
