/**
 * Ceremony rooms — the live multiplayer transport for the standup/planning
 * round-table surface. Mounted under /api/agile (so it inherits that group's
 * authMiddleware) at /ceremonies.
 *
 * A ceremony has no durable domain state of its own: task/sprint/epic mutations
 * go through the existing (segment-scoped, validated, cached) task + agile REST
 * routes. This module only provides the WebSocket channel — clients hold it to
 * exchange presence/cursor frames and to relay a `changed` signal after a
 * mutation so peers re-fetch. Room id = the project id, so a board's standup and
 * planning share one room (`ceremony:<projectId>`).
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// db is unused today (the room is stateless), but kept in the signature for
// parity with the other agile sub-route factories and future REST endpoints.
export function createCeremonyRoutes(_db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Live channel: clients hold this WebSocket for presence + relayed updates.
  r.get('/rooms/:id/ws', (c) => {
    if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
    const ns = c.env?.CEREMONY_ROOM;
    if (!ns) return c.text('Realtime unavailable', 503);
    return ns.get(ns.idFromName(`ceremony:${c.req.param('id')}`)).fetch(c.req.raw);
  });

  return r;
}
