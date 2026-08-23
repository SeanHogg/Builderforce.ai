import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TenantRole } from '../../domain/shared/types';
import { authMiddleware } from '../middleware/authMiddleware';
import { admitToCollabRoom } from '../../application/collab/collabScopes';
import { relayToRoom } from './realtimeRelay';

/**
 * REAL-TIME CO-EDITING — /api/collab/<scope>:<id>
 *
 * One route, because `y-websocket` speaks one URL shape: it appends the room name
 * to the base URL as a single path segment and puts everything else in the query
 * string. So the browser asks for `wss://<api>/api/collab/knowledge:<uuid>` and
 * this is the door.
 *
 * ── WHAT THIS ROUTE IS FOR ───────────────────────────────────────────────────
 * The room itself (`CollaborationRoomDO`) is server-authoritative: it holds the
 * `Y.Doc`, answers the sync handshake and persists. What it cannot do is decide
 * who may open it — a Durable Object sees a socket, never a session. Everything
 * here is that decision:
 *
 *   1. AUTHENTICATE. `authMiddleware`, which already accepts `?token=` because a
 *      browser cannot set an Authorization header on a WebSocket.
 *   2. AUTHORIZE, per scope, through `collabScopes` — a room name that names no
 *      declared scope is not a room, and a document this person may not edit is
 *      not one they may join. (There is no read-only membership of a CRDT room:
 *      a socket that is in can type.)
 *   3. NAME THE INSTANCE. Never the client's string — the registry returns a
 *      tenant-prefixed instance name, so two workspaces holding the same document
 *      id cannot land in one shared document.
 *   4. STAMP THE IDENTITY. `relayToRoom` strips any relay header the client sent
 *      and writes the one the session resolved, so a participant cannot author a
 *      frame as somebody else.
 *
 * The standalone `worker/` this replaces did none of the four.
 */
export function createCollabRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:room', async (c) => {
    const admission = await admitToCollabRoom(db, c.req.param('room'), {
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      role: c.get('role') as TenantRole,
    });

    if (!admission.ok) {
      // `unknown-scope` and `not-found` both answer 404 on purpose: telling them
      // apart would let a caller enumerate which document ids exist by probing.
      if (admission.reason === 'forbidden') return c.text('Forbidden', 403);
      return c.text('Not found', 404);
    }

    return relayToRoom(c, c.env?.COLLABORATION_ROOM, admission.room, {
      ref: c.get('userId') as string,
      kind: 'human',
    });
  });

  return router;
}
