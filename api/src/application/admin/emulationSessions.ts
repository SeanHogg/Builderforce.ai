/**
 * The emulation middleware's reads and writes against `admin_impersonation_sessions`.
 *
 * The middleware runs on EVERY request carrying `X-Emulation-Token`, and every DB
 * statement is an HTTPS round trip that also keeps the Neon compute awake. It used
 * to SELECT the session on every request and UPDATE `pages_visited` on every GET;
 * both now go through the read-through cache.
 *
 * STALENESS: the session verdict is cached for {@link SESSION_L1_TTL_MS} in-isolate
 * and {@link SESSION_KV_TTL_SECONDS} in KV (the KV minimum). Ending or re-roling a
 * session calls {@link invalidateEmulationSession}, which drops it at once in the
 * writer's isolate and from KV; another isolate or region can keep honouring an
 * ended session for at most ~60s (L1 15s, then KV propagation). The token itself is
 * read-only and expires after an hour regardless.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { adminImpersonationSessions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

export const SESSION_L1_TTL_MS = 15_000;
export const SESSION_KV_TTL_SECONDS = 60;
/** A session lives at most an hour (the token's `exp`), so one marker per path covers it. */
const VISIT_MARKER_TTL_SECONDS = 3600;

/** What the middleware needs to decide whether a token is still honoured.
 *  `ended` rather than `endedAt`: a Date does not survive the KV round trip. */
export interface EmulationSessionVerdict {
  ended: boolean;
  tokenJti: string | null;
}

/** Versioned so a shape change never reads an old entry. */
export const emulationSessionCacheKey = (sessionId: string): string => `emu:session:v1:${sessionId}`;

/** KV keys cap at 512 bytes; a path past that is truncated, which at worst skips
 *  recording a second, distinct, very long path in the same session. */
const visitMarkerKey = (sessionId: string, path: string): string =>
  `emu:visited:v1:${sessionId}:${path.slice(0, 400)}`;

/** The session's verdict, or null when it does not exist (in this tenant). */
export function loadEmulationSession(
  env: CacheEnv,
  db: Db,
  tenantId: number,
  sessionId: string,
): Promise<EmulationSessionVerdict | null> {
  return getOrSetCached(
    env,
    emulationSessionCacheKey(sessionId),
    async () => {
      const [row] = await db
        .select({ endedAt: adminImpersonationSessions.endedAt, tokenJti: adminImpersonationSessions.tokenJti })
        .from(adminImpersonationSessions)
        .where(scopedToTenant(adminImpersonationSessions, tenantId, eq(adminImpersonationSessions.id, sessionId)))
        .limit(1);
      return row ? { ended: row.endedAt !== null, tokenJti: row.tokenJti ?? null } : null;
    },
    { l1TtlMs: SESSION_L1_TTL_MS, kvTtlSeconds: SESSION_KV_TTL_SECONDS },
  );
}

/** Call from every writer that ends a session or changes its token JTI. */
export function invalidateEmulationSession(env: CacheEnv, sessionId: string): Promise<void> {
  return invalidateCached(env, emulationSessionCacheKey(sessionId));
}

/** Audit a blocked write. Rare (a read-only session attempting a mutation), so uncached. */
export async function recordEmulationWriteBlock(db: Db, tenantId: number, sessionId: string): Promise<void> {
  await db
    .update(adminImpersonationSessions)
    .set({ writeBlockCount: sql`${adminImpersonationSessions.writeBlockCount} + 1` })
    .where(scopedToTenant(adminImpersonationSessions, tenantId, eq(adminImpersonationSessions.id, sessionId)));
}

/**
 * Record that the session visited `path` — once per distinct path, not once per GET.
 *
 * The audit views only show how MANY pages a session touched, and a polling page
 * used to append the same path every few seconds (one UPDATE each). The cache
 * marker means the loader — the write — runs once per (session, path); the SQL
 * `NOT EXISTS` keeps a second isolate that missed the marker from appending a
 * duplicate. Element format is unchanged (a JSON string of `{ path, ts }`), so
 * existing rows and readers are untouched.
 */
export async function recordEmulationPageVisit(
  env: CacheEnv,
  db: Db,
  tenantId: number,
  sessionId: string,
  path: string,
): Promise<void> {
  await getOrSetCached(
    env,
    visitMarkerKey(sessionId, path),
    async () => {
      const entry = JSON.stringify({ path, ts: new Date().toISOString() });
      await db
        .update(adminImpersonationSessions)
        .set({
          pagesVisited: sql`jsonb_insert(coalesce(${adminImpersonationSessions.pagesVisited}, '[]'::jsonb), '{-1}', to_jsonb(${entry}::text), true)`,
        })
        .where(scopedToTenant(
          adminImpersonationSessions,
          tenantId,
          eq(adminImpersonationSessions.id, sessionId),
          sql`not exists (select 1 from jsonb_array_elements_text(coalesce(${adminImpersonationSessions.pagesVisited}, '[]'::jsonb)) as e(v) where e.v::jsonb ->> 'path' = ${path})`,
        ));
      return true;
    },
    { kvTtlSeconds: VISIT_MARKER_TTL_SECONDS },
  );
}
