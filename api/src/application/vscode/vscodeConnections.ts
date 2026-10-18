/**
 * VS Code editor presence — `vscode_connections`, one row per (tenant, user, machine).
 *
 * The extension heartbeats `connect` every few minutes and the dashboard's Workforce
 * tab lists the rows every 30 s. Both used to cost database round trips on every call
 * (connect = SELECT then UPDATE/INSERT; list = a whole-row scan), which kept the core
 * Neon compute awake for presence data. Connect is now ONE upsert on the unique index
 * from migration 0202, and the list is read through the cache, invalidated by connect.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { vscodeConnections } from '../../infrastructure/database/schema';
import { excluded } from '../../infrastructure/database/upsert';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

/** KV's minimum TTL is 60 s; a connect also invalidates, so this only bounds other writers. */
const LIST_TTL_SECONDS = 60;
const LIST_L1_TTL_MS = 30_000;
const LIST_LIMIT = 100;

export const vscodeConnectionsCacheKey = (tenantId: number): string => `vscode:connections:${tenantId}`;

/** Register or heartbeat a connection: one statement, no read. */
export async function upsertVscodeConnection(
  db: Db,
  env: CacheEnv,
  input: { tenantId: number; userId: string; machineName: string; extensionVersion: string | null },
): Promise<void> {
  await db
    .insert(vscodeConnections)
    .values(input)
    .onConflictDoUpdate({
      target: [vscodeConnections.tenantId, vscodeConnections.userId, vscodeConnections.machineName],
      set: {
        status: 'active',
        extensionVersion: excluded(vscodeConnections.extensionVersion),
        lastSeenAt: sql`now()`,
      },
    });
  await invalidateCached(env, vscodeConnectionsCacheKey(input.tenantId));
}

/** The tenant's connections, newest heartbeat first (only the columns the UI reads). */
export function listVscodeConnections(db: Db, env: CacheEnv, tenantId: number) {
  return getOrSetCached(
    env,
    vscodeConnectionsCacheKey(tenantId),
    () => db
      .select({
        id: vscodeConnections.id,
        tenantId: vscodeConnections.tenantId,
        userId: vscodeConnections.userId,
        machineName: vscodeConnections.machineName,
        extensionVersion: vscodeConnections.extensionVersion,
        status: vscodeConnections.status,
        connectedAt: vscodeConnections.connectedAt,
        lastSeenAt: vscodeConnections.lastSeenAt,
      })
      .from(vscodeConnections)
      .where(eq(vscodeConnections.tenantId, tenantId))
      .orderBy(desc(vscodeConnections.lastSeenAt))
      .limit(LIST_LIMIT),
    { kvTtlSeconds: LIST_TTL_SECONDS, l1TtlMs: LIST_L1_TTL_MS },
  );
}
