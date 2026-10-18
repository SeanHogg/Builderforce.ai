/**
 * VS Code editor presence — `vscode_connections`, one row per (tenant, user, machine).
 *
 * The extension heartbeats `connect` every few minutes and the dashboard's Workforce
 * tab lists the rows every 30 s. Both used to cost database round trips on every call
 * (connect = SELECT then UPDATE/INSERT; list = a whole-row scan), which kept the core
 * Neon compute awake for presence data. Connect is now ONE upsert on the unique index
 * from migration 0202, and the list is read through the cache, invalidated by connect.
 *
 * Connect is also THROTTLED (the agent-host heartbeat rule): an extension beating every
 * few minutes writes only when its version changed or the last write is older than
 * {@link CONNECT_WRITE_THROTTLE_MS}; the list cache is dropped only by a write that
 * changed something the list shows (a new/unknown row or a new version).
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { vscodeConnections } from '../../infrastructure/database/schema';
import { excluded } from '../../infrastructure/database/upsert';
import {
  getOrSetCached, invalidateCached, peekCached, setCached, type CacheEnv,
} from '../../infrastructure/cache/readThroughCache';
import { throttledWriteDue } from '../agentHost/heartbeatThrottle';

/** KV's minimum TTL is 60 s; a connect also invalidates, so this only bounds other writers. */
const LIST_TTL_SECONDS = 60;
const LIST_L1_TTL_MS = 30_000;
const LIST_LIMIT = 100;

/** Skip the upsert while the last write is younger than this and nothing changed. */
export const CONNECT_WRITE_THROTTLE_MS = 10 * 60_000;
const STATE_KV_TTL_SECONDS = 24 * 60 * 60;

interface ConnectState { version: string | null; writtenAtMs: number }
const connectStateKey = (i: { tenantId: number; userId: string; machineName: string }): string =>
  `vscode:connect:state:${i.tenantId}:${i.userId}:${i.machineName}`;

export const vscodeConnectionsCacheKey = (tenantId: number): string => `vscode:connections:${tenantId}`;

/**
 * Register or heartbeat a connection: at most one statement, none when the beat is
 * redundant. Returns whether a row write happened.
 */
export async function upsertVscodeConnection(
  db: Db,
  env: CacheEnv,
  input: { tenantId: number; userId: string; machineName: string; extensionVersion: string | null },
): Promise<boolean> {
  const stateKey = connectStateKey(input);
  const state = await peekCached<ConnectState>(env, stateKey);
  const versionChanged = state != null && state.version !== input.extensionVersion;
  if (!throttledWriteDue({
    lastWrittenAtMs: state ? state.writtenAtMs : null,
    throttleMs: CONNECT_WRITE_THROTTLE_MS,
    changed: versionChanged,
  })) return false;

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
  await setCached<ConnectState>(
    env, stateKey, { version: input.extensionVersion, writtenAtMs: Date.now() },
    { kvTtlSeconds: STATE_KV_TTL_SECONDS, l1TtlMs: CONNECT_WRITE_THROTTLE_MS },
  );
  // A liveness-only refresh of a known row changes just `lastSeenAt`, which the list's
  // own 60 s TTL already bounds; only a new/unknown row or a new version is worth a drop.
  if (state == null || versionChanged) await invalidateCached(env, vscodeConnectionsCacheKey(input.tenantId));
  return true;
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
