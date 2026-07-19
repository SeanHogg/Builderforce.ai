/**
 * Board-sync sweep — the cron-driven half of external board synchronization.
 *
 * For every active `board_connections` row whose `poll_interval_sec` has elapsed
 * since its `last_polled_at`, this:
 *   1. inbound-polls the provider (`SyncEngine.syncConnection`) — which advances
 *      `pollCursor`/`lastPolledAt` and writes a sync log, and
 *   2. drains the transactional outbox (`SyncEngine.drainOutbox`) so locally
 *      originated changes are pushed back to the provider with retry/backoff.
 *
 * Invoked from the Worker `scheduled()` handler on the frequent tick (mirrors
 * `runDueTriggers`). Each connection is processed independently so one bad
 * credential / unreachable provider can't stall the rest of the sweep. Cheap on
 * an idle tick: a single indexed "active connections" query, then an in-memory
 * due-filter (connection counts are small, per-tenant).
 */

import { eq } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { boardConnections } from '../../infrastructure/database/schema';
import { SyncEngine, type StoredConnection } from './SyncEngine';
import { createDrizzleStore, loadConnectionCredentials } from './drizzleStore';
import { createBoardProvider } from './providers';
import { isItsmProvider, syncItsmConnection } from './itsmIngest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface BoardSyncSweepEnv {
  NEON_DATABASE_URL: string;
  INTEGRATION_ENCRYPTION_SECRET?: string;
  JWT_SECRET: string;
  /** Optional — present when invoked from the Worker scheduled() handler. Lets the
   *  ITSM path bump the Quality lens cache. Degrades gracefully when absent. */
  AUTH_CACHE_KV?: KVNamespace;
}

export interface BoardSyncSweepResult {
  due: number;
  synced: number;
  drained: number;
  errors: number;
}

/** A connection is due when it has never polled or its interval has elapsed. Pure; exported for tests. */
export function isDue(
  conn: { lastPolledAt: Date | null; pollIntervalSec: number },
  now: Date,
): boolean {
  if (!conn.lastPolledAt) return true;
  const elapsedMs = now.getTime() - conn.lastPolledAt.getTime();
  return elapsedMs >= conn.pollIntervalSec * 1000;
}

/** Build a SyncEngine for one connection, resolving + decrypting its credentials. */
async function engineForConnection(
  db: Db,
  secret: string,
  conn: typeof boardConnections.$inferSelect,
  env: Env,
): Promise<SyncEngine | null> {
  const loaded = await loadConnectionCredentials(db, conn.tenantId, conn.credentialId, secret);
  if (!loaded) return null; // bad/missing credential — skip, surfaced via sync log on next manual run
  // `env` is what lets a ticket synced IN fire the lane auto-run trigger (the funnel
  // in drizzleStore.upsertTask); without it the inbound path lands tickets silently.
  const store = createDrizzleStore(db, env);
  return new SyncEngine(store, (sc: StoredConnection) =>
    createBoardProvider(
      sc.provider,
      { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId: conn.externalBoardId },
      fetch,
    ),
  );
}

/**
 * Poll + drain every active board connection whose interval has elapsed.
 * Safe to call on every cron tick.
 */
export async function runBoardSyncSweep(env: BoardSyncSweepEnv): Promise<BoardSyncSweepResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
  const now = new Date();

  const active = await db
    .select()
    .from(boardConnections)
    .where(eq(boardConnections.status, 'active'));

  const due = active.filter((conn) => isDue(conn, now));

  let synced = 0;
  let drained = 0;
  let errors = 0;

  for (const conn of due) {
    try {
      // ITSM connections (Freshservice/ServiceNow) feed support_tickets (the
      // Quality lens), NOT the task board — divert them before the task engine.
      if (isItsmProvider(conn.provider)) {
        const loaded = await loadConnectionCredentials(db, conn.tenantId, conn.credentialId, secret);
        if (!loaded) { errors++; continue; }
        const provider = createBoardProvider(
          conn.provider,
          { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId: conn.externalBoardId },
          fetch,
        );
        await syncItsmConnection(db, env as unknown as Env, conn, provider, createDrizzleStore(db, env as unknown as Env));
        synced++;
        continue; // read-only into support_tickets; no outbox drain
      }

      const engine = await engineForConnection(db, secret, conn, env as unknown as Env);
      if (!engine) {
        errors++;
        continue;
      }
      // Inbound poll first (advances cursor + lastPolledAt), then reverse drain.
      await engine.syncConnection(conn.id);
      synced++;
      const drainResult = await engine.drainOutbox(conn.id);
      drained += drainResult.succeeded;
    } catch (e) {
      errors++;
      console.error(`[cron:board-sync] connection ${conn.id} failed`, e);
    }
  }

  console.log(`[cron:board-sync] due=${due.length} synced=${synced} drained=${drained} errors=${errors}`);
  return { due: due.length, synced, drained, errors };
}
