/**
 * A JOB BOARD A TENANT SOURCES FROM — configured, credentialed, and safe to fetch.
 *
 * ── WHY THERE IS NO `job_board_sources` TABLE ────────────────────────────────
 * The coverage map files it under `connection`, and it is one exactly: a vendor,
 * an external account, a status, a `lastSyncedAt`, a JSON config and a secret
 * held elsewhere. Every column the source product's table carried is one of
 * those, and giving sourcing its own copy would mean a second place where
 * "connected, expired, revoked" is spelled — with its own disconnect path that
 * forgets to revoke the credential.
 *
 * `capability = 'job_board'` is what separates these rows from a mailbox or a
 * repo on the same primitive.
 *
 * ── THE API KEY IS NOT A COLUMN ──────────────────────────────────────────────
 * The source product held `api_key text` on the row, so a SELECT * anywhere —
 * an admin list, a debug log, an export — carried the secret with it. Here it
 * goes into the kernel `credentials` seal like every other secret on the
 * platform, and the connection row holds only the fact that one exists.
 *
 * ── THE URL IS CHECKED WHEN IT IS SAVED, AND AGAIN WHEN IT IS FETCHED ────────
 * A feed URL is operator-supplied and this platform fetches it on a schedule,
 * which is the textbook shape of a server-side request forgery: point a "job
 * feed" at `http://169.254.169.254/` and the cron hands back cloud credentials.
 * `assertSafeUrl` runs at author time so the mistake is caught by the person
 * making it, and `resolveAndAssertPublic` runs at fetch time because a hostname
 * that resolved publicly yesterday can resolve to a private address today. The
 * source product did neither.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { connections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';
import {
  deleteConnectionApiKey, hasConnectionApiKey, readConnectionApiKey, writeConnectionApiKey,
} from '../integrations/connectionApiKey';
import type { FeedFormat, JsonFeedConfig } from './sourcingFeed';

/** The `connections.capability` that marks a row as a sourcing feed. */
export const JOB_BOARD_CAPABILITY = 'job_board';

/** The `sync_states.resource` these feeds checkpoint under. */
export const JOB_BOARD_RESOURCE = 'job_listings';

export interface SourceConfig extends JsonFeedConfig {
  url: string;
  format: FeedFormat;
  /** Listings older than this are not written. Absent = write everything. */
  maxAgeDays?: number;
}

export interface JobBoardSource {
  id: number;
  name: string;
  vendor: string;
  url: string;
  format: FeedFormat;
  status: string;
  hasApiKey: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  config: JsonFeedConfig;
}

export type SourceRefusal = { ok: false; reason: 'invalid_url'; detail: string };

/**
 * Add or update a feed.
 *
 * Upserts on the connection's own natural key, so re-adding the same feed edits
 * it rather than creating a second row that the sweep would then fetch twice.
 */
export async function saveSource(
  db: Db, env: Env,
  input: {
    tenantId: number; userId: string | null; name: string; vendor: string;
    config: SourceConfig; apiKey?: string | null;
  },
): Promise<{ ok: true; source: JobBoardSource } | SourceRefusal> {
  let url: URL;
  try {
    url = assertSafeUrl(input.config.url);
  } catch (error) {
    return { ok: false, reason: 'invalid_url', detail: error instanceof Error ? error.message : 'Unusable feed URL' };
  }

  // The external account is the ORIGIN, not the full URL: two feeds from the
  // same board are two rows, and the uniqueness key has to let them both exist.
  const externalAccount = `${url.origin}${url.pathname}`.slice(0, 320);

  const [row] = await db.insert(connections).values({
    tenantId: input.tenantId,
    userId: input.userId,
    vendor: input.vendor.slice(0, 64),
    capability: JOB_BOARD_CAPABILITY,
    externalAccount,
    displayName: input.name.slice(0, 255),
    status: 'connected',
    config: input.config,
  }).onConflictDoUpdate({
    target: [connections.tenantId, connections.userId, connections.vendor, connections.capability, connections.externalAccount],
    set: {
      displayName: input.name.slice(0, 255),
      config: input.config,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    },
  }).returning();

  if (!row) throw new Error('job board connection was not written');

  // A key is written only when one was supplied: an edit that leaves the field
  // blank must not silently erase a working credential.
  if (input.apiKey) {
    await writeConnectionApiKey(db, env, {
      tenantId: input.tenantId, connectionId: row.id, apiKey: input.apiKey,
    });
  }

  return { ok: true, source: await toSource(db, row) };
}

export async function listSources(db: Db, tenantId: number): Promise<JobBoardSource[]> {
  const rows = await db.select().from(connections).where(and(
    eq(connections.tenantId, tenantId),
    eq(connections.capability, JOB_BOARD_CAPABILITY),
  ));
  return Promise.all(rows.map((row) => toSource(db, row)));
}

export async function getSource(
  db: Db, tenantId: number, id: number,
): Promise<JobBoardSource | null> {
  const [row] = await db.select().from(connections).where(scopedToTenant(
    connections, tenantId,
    and(eq(connections.id, id), eq(connections.capability, JOB_BOARD_CAPABILITY))!,
  )).limit(1);
  return row ? toSource(db, row) : null;
}

/**
 * Remove a feed.
 *
 * The credential goes with it. A connection deleted while its secret survives is
 * an orphaned key nothing will ever rotate and nothing will ever use — the exact
 * residue an `api_key` column made invisible.
 *
 * Listings already written are NOT deleted: they are catalogue rows somebody may
 * have saved or applied to, and removing the feed is a statement about future
 * fetches, not about history.
 */
export async function deleteSource(db: Db, tenantId: number, id: number): Promise<boolean> {
  const existing = await getSource(db, tenantId, id);
  if (!existing) return false;
  await deleteConnectionApiKey(db, tenantId, id);
  await db.delete(connections).where(scopedToTenant(connections, tenantId, eq(connections.id, id)));
  return true;
}

/** The API key for a feed, or null. Read at FETCH time only — the listing path
 *  asks `hasConnectionApiKey` instead, which answers without decrypting. */
export async function sourceApiKey(
  db: Db, env: Env, tenantId: number, connectionId: number,
): Promise<string | null> {
  return readConnectionApiKey(db, env, tenantId, connectionId);
}

async function toSource(
  db: Db, row: typeof connections.$inferSelect,
): Promise<JobBoardSource> {
  const config = (row.config ?? {}) as SourceConfig;
  return {
    id: row.id,
    name: row.displayName,
    vendor: row.vendor,
    url: config.url ?? '',
    format: config.format === 'json' ? 'json' : 'rss',
    status: row.status,
    hasApiKey: await hasConnectionApiKey(db, row.tenantId, row.id),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    config: { itemsPath: config.itemsPath, mapping: config.mapping },
  };
}
