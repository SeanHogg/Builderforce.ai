/**
 * External-calendar free/busy for the meeting scheduler. The "find a time" solver
 * already intersects each attendee's declared availability windows and their in-app
 * meetings; this adds the busy blocks from each attendee's OWN connected Google /
 * Microsoft calendar so a teammate booked outside Builderforce is never proposed.
 *
 * Per-user reads only: we mint a fresh token from the attendee's own
 * `calendar_connections` row (each attendee connects their calendar), never the
 * requester's — so cross-attendee free/busy works without one user holding
 * everyone's tokens. Best-effort + cached, since it fans out one provider call per
 * connected attendee on every find-a-time.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { calendarConnections } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { getCalendarProvider } from './calendarProviders';
import { freshAccessToken } from './calendarService';
import type { BusyInterval } from './availabilitySolver';

/**
 * Busy intervals (epoch-ms) per user ref, unioned across each user's connected
 * calendars. A provider/token failure yields no blocks for that connection (never
 * throws). Cached ~2min per (connection, window) to protect against fan-out when a
 * scheduler re-runs find-a-time as the invitee set changes.
 */
export async function loadExternalBusy(
  db: Db,
  env: Env,
  tenantId: number,
  refs: string[],
  fromMs: number,
  toMs: number,
): Promise<Map<string, BusyInterval[]>> {
  const out = new Map<string, BusyInterval[]>();
  if (refs.length === 0) return out;

  const conns = await db.select().from(calendarConnections).where(and(
    eq(calendarConnections.tenantId, tenantId),
    inArray(calendarConnections.userId, refs),
  ));
  if (conns.length === 0) return out;

  const timeMinISO = new Date(fromMs).toISOString();
  const timeMaxISO = new Date(toMs).toISOString();
  // Hour-bucketed window → a stable cache key (find-a-time uses now→+14d).
  const winKey = `${Math.floor(fromMs / 3_600_000)}-${Math.floor(toMs / 3_600_000)}`;

  await Promise.all(conns.map(async (conn) => {
    const provider = getCalendarProvider(conn.provider);
    if (!provider?.freeBusy) return;
    try {
      const blocks = await getOrSetCached(
        env,
        `cal:freebusy:${conn.id}:${winKey}`,
        async () => {
          const token = await freshAccessToken(db, env, conn);
          if (!token) return [] as Array<{ startISO: string; endISO: string }>;
          return provider.freeBusy(token, conn.calendarId, {
            accountEmail: conn.accountEmail ?? undefined, timeMinISO, timeMaxISO,
          });
        },
        { kvTtlSeconds: 120, l1TtlMs: 120_000 },
      );
      const intervals: BusyInterval[] = blocks
        .map((b) => ({ start: Date.parse(b.startISO), end: Date.parse(b.endISO) }))
        .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
      if (intervals.length === 0) return;
      const list = out.get(conn.userId) ?? [];
      list.push(...intervals);
      out.set(conn.userId, list);
    } catch { /* best-effort per connection */ }
  }));

  return out;
}

/** Union any number of busy maps (in-app + external) into a fresh map. */
export function mergeBusy(...maps: Array<Map<string, BusyInterval[]>>): Map<string, BusyInterval[]> {
  const out = new Map<string, BusyInterval[]>();
  for (const m of maps) {
    for (const [ref, intervals] of m) {
      const list = out.get(ref) ?? [];
      list.push(...intervals);
      out.set(ref, list);
    }
  }
  return out;
}
