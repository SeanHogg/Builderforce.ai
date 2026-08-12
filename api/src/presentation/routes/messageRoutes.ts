/**
 * Message routes — /api/messages
 *
 *   GET    /contacts              → who this person may start a conversation with
 *   GET    /threads               → my conversations + unread counts
 *   POST   /threads               → open one (or return the one already open)
 *   GET    /threads/:id           → the transcript
 *   POST   /threads/:id           → say something
 *   POST   /threads/:id/read      → move my read cursor
 *   GET    /threads/:id/ws        → live: this conversation changed
 *   GET    /ws                    → live: ANY of my conversations changed
 *
 * Authorisation is the SERVICE's, not this file's — who may reach whom is a
 * domain rule with two callers (the picker and the guard), so it lives once in
 * `DirectMessageService` and a route that tried to restate it would be the drift.
 *
 * The two websocket routes are the same `relayToRoom` every other live surface
 * uses; nothing but `{"type":"changed"}` crosses them, so no message body ever
 * travels through the relay.
 */

import { Hono } from 'hono';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { DirectMessageService, dmThreadRoomName, dmUserRoomName } from '../../application/messaging/DirectMessageService';
import { relayToRoom } from './realtimeRelay';

export function createMessageRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', webAuthMiddleware);

  const service = (c: { env: unknown }) => new DirectMessageService(db, c.env as Env);
  const userId = (c: { get: (key: 'userId') => unknown }) => c.get('userId') as string;

  r.get('/contacts', async (c) => c.json({ contacts: await service(c).contacts(userId(c)) }));

  r.get('/threads', async (c) => {
    const threads = await service(c).threads(userId(c));
    return c.json({ threads, unread: threads.reduce((sum, thread) => sum + thread.unread, 0) });
  });

  r.post('/threads', async (c) => {
    const body = await c.req.json<{ userId?: string; subject?: string }>();
    const other = typeof body.userId === 'string' ? body.userId : '';
    if (!other) return c.json({ error: 'A recipient is required.' }, 400);
    const thread = await service(c).open(userId(c), other, body.subject ?? '');
    return thread ? c.json(thread, 201) : c.json({ error: 'You cannot start a conversation with that person.' }, 403);
  });

  r.get('/threads/:id', async (c) => {
    const list = await service(c).messages(c.req.param('id'), userId(c));
    return list ? c.json({ messages: list }) : c.json({ error: 'Conversation not found.' }, 404);
  });

  r.post('/threads/:id', async (c) => {
    const body = await c.req.json<{ body?: string }>();
    const message = await service(c).send(c.req.param('id'), userId(c), body.body ?? '');
    return message ? c.json(message, 201) : c.json({ error: 'Message could not be sent.' }, 400);
  });

  r.post('/threads/:id/read', async (c) => {
    const ok = await service(c).markRead(c.req.param('id'), userId(c));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Conversation not found.' }, 404);
  });

  r.get('/threads/:id/ws', (c) => relayToRoom(c, c.env?.SESSION_ROOM, dmThreadRoomName(c.req.param('id'))));
  r.get('/ws', (c) => relayToRoom(c, c.env?.SESSION_ROOM, dmUserRoomName(userId(c))));

  return r;
}
