/**
 * FETCHING A JOB FEED AND WRITING WHAT CAME BACK.
 *
 * ── THE THREE PRIMITIVES, AND WHY NOT THREE TABLES ───────────────────────────
 *   • the FEED is a `connections` row            (see `sourcingSources`)
 *   • the CURSOR is a `sync_states` row          — `recordsSeen`, `recordsWritten`,
 *     `lastRunAt`, `lastSuccessAt`, `lastError`, `status`: every counter the
 *     source product's `job_board_sync_log` carried, already on the primitive
 *   • the HISTORY is an `activity_log` row       — one event per completed run
 *   • the LISTING is a `catalog_items` row       — kind `job_listing`
 *
 * The source product had `job_board_sync_log` holding BOTH the current state and
 * the history, which is why "when did this last succeed" needed a MAX() over a
 * growing table. Splitting them puts the answer on one indexed row and leaves the
 * audit trail where every other event on this platform already lives.
 *
 * ── WHY A SCRAPED LISTING IS A `catalog_item` AND NOT A `job_posting` ────────
 * `job_postings` is the freelance marketplace's own posting — a tenant authored
 * it, freelancers bid on it, it has a budget and screening questions. A row
 * scraped from somebody else's board has no author here, no bidding, and no
 * owner; putting it in that table would drop third-party listings into the pool
 * the marketplace takes proposals against.
 *
 * The coverage map's `HV job_items → keep job_items` is a NAME COLLISION and is
 * corrected in the same commit: this schema's `job_items` is "a line item on a
 * job — a requirement, a benefit, a responsibility", a bullet under a posting.
 * The map's own answer for this concept is its `job_sourcing_listings →
 * catalog_item` row, which is what this uses.
 *
 * ── DEDUPLICATION IS AN INDEX, NOT A QUERY ───────────────────────────────────
 * `uq_catalog_items_slug (tenant, kind, slug)` already exists, and the listing's
 * fingerprint IS the slug. So a re-run is `onConflictDoUpdate` — one statement,
 * no read, and correct when two runs overlap. The source product issued a SELECT
 * per item and still double-inserted whenever a manual sync raced the cron.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, connections, syncStates } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { recordActivity, SYSTEM_ACTOR } from '../activity/activityLog';
import { listingSlug, parseJsonFeed, parseRssFeed, type SourcedListing } from './sourcingFeed';
import { JOB_BOARD_CAPABILITY, JOB_BOARD_RESOURCE, sourceApiKey, type SourceConfig } from './sourcingSources';

/** The `catalog_items.kind` every sourced listing carries. */
export const JOB_LISTING_KIND = 'job_listing';

/** The verb a completed run is filed under in `activity_log`. */
export const SOURCING_VERB = 'sourcing.sync';

/**
 * The version token behind every cached listing query for a tenant.
 *
 * Exported and owned HERE rather than in the route, because the WRITER is what
 * must invalidate: the cron sweep and the manual sync both land here, and a token
 * defined next to the reader would leave the scheduled path — the one that writes
 * most of the rows — serving a stale catalogue until each key's TTL expired.
 */
export const listingsVersionKey = (tenantId: number) => `sourcing:listings:t:${tenantId}`;

/** A feed body larger than this is refused unread. A scraper that streams an
 *  unbounded response into a Worker is a memory limit waiting to be hit by
 *  whoever controls the other end of the socket. */
const MAX_FEED_BYTES = 5 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 15_000;

export interface SourceSyncResult {
  connectionId: number;
  fetched: number;
  written: number;
  skipped: number;
  error: string | null;
}

/**
 * Fetch one feed and write its listings.
 *
 * Never throws: a feed that 500s, times out or serves malformed XML is a normal
 * Tuesday for a scraper, and one bad source must not abort a sweep over the
 * others. The failure is recorded on the connection and the sync state, where an
 * operator can see it, rather than raised into the caller's face.
 */
export async function syncJobSource(
  db: Db, env: Env,
  source: { id: number; tenantId: number; config: SourceConfig },
): Promise<SourceSyncResult> {
  const result: SourceSyncResult = {
    connectionId: source.id, fetched: 0, written: 0, skipped: 0, error: null,
  };

  await markRunning(db, source.tenantId, source.id);

  try {
    const listings = await fetchListings(db, env, source);
    result.fetched = listings.length;

    for (const listing of listings) {
      const written = await writeListing(db, source.tenantId, source.id, listing);
      if (written) result.written += 1; else result.skipped += 1;
    }

    await markSuccess(db, source.tenantId, source.id, result);
    // Only on a run that actually wrote something: bumping on a no-op sweep would
    // throw away a warm cache every hour for nothing.
    if (result.written > 0) await bumpCacheVersion(env, listingsVersionKey(source.tenantId));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await markFailed(db, source.tenantId, source.id, result.error);
  }

  // The run is filed whether it worked or not — "this feed has failed every hour
  // for three days" is only answerable if the failures are recorded too.
  await recordActivity(env, db, {
    tenantId: source.tenantId,
    actor: SYSTEM_ACTOR,
    verb: SOURCING_VERB,
    targetType: 'connection',
    targetId: String(source.id),
    targetLabel: source.config.url,
    summary: result.error
      ? `Job feed sync failed: ${result.error}`
      : `Job feed sync — ${result.fetched} fetched, ${result.written} written, ${result.skipped} unchanged`,
    metadata: { ...result },
  });

  return result;
}

// ── Fetching ───────────────────────────────────────────────────────────────

async function fetchListings(
  db: Db, env: Env,
  source: { id: number; tenantId: number; config: SourceConfig },
): Promise<SourcedListing[]> {
  // Re-checked at FETCH time, not only when the operator saved it: DNS is not
  // immutable, and a hostname that resolved to a public address last week can be
  // repointed at link-local metadata today. This is the check that makes a
  // scheduled fetch of an operator-supplied URL safe to run at all.
  const url = assertSafeUrl(source.config.url);
  await resolveAndAssertPublic(url.hostname);

  const apiKey = await sourceApiKey(db, env, source.tenantId, source.id);

  const response = await fetchFollowingSafely(url, {
    'User-Agent': 'BuilderforceBot/1.0 (+https://builderforce.ai)',
    Accept: source.config.format === 'json'
      ? 'application/json'
      : 'application/rss+xml, application/atom+xml, application/xml;q=0.9',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_FEED_BYTES) throw new Error(`Feed is ${declared} bytes, over the ${MAX_FEED_BYTES} limit`);

  const body = await response.text();
  // The header is a claim; this is the measurement. A server that omits or
  // understates `content-length` must still not be able to exhaust the isolate.
  if (body.length > MAX_FEED_BYTES) throw new Error(`Feed body exceeded the ${MAX_FEED_BYTES} byte limit`);

  if (source.config.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('Feed did not return valid JSON');
    }
    return parseJsonFeed(parsed, source.config);
  }
  return parseRssFeed(body);
}

/** How many hops a feed may redirect through before this gives up. Feeds do
 *  legitimately redirect — http→https, apex→www, a CDN — and an unbounded chain
 *  is a loop or a tarpit. */
const MAX_REDIRECTS = 3;

/**
 * Fetch, following redirects BY HAND so every hop is checked.
 *
 * `redirect: 'follow'` would defeat the SSRF guard completely: the guard proves
 * the URL an operator typed is public, and then `fetch` silently follows a
 * `Location:` header — chosen by the far end, not by us — to wherever it likes,
 * including `http://169.254.169.254/`. Validating only the first URL of a chain
 * checks the one hop an attacker does not control.
 *
 * So `redirect: 'manual'`, and each `Location` goes back through the same two
 * checks the original URL did. This is the rule the connector runtime already
 * follows for the same reason; sourcing was the one outbound path that did not.
 *
 * The Authorization header is dropped the moment the ORIGIN changes: a feed that
 * redirects off-host must not carry the operator's API key to a third party.
 */
async function fetchFollowingSafely(
  start: URL, headers: Record<string, string>,
): Promise<Response> {
  let target = start;
  let sent = headers;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(target.toString(), {
      headers: sent,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });

    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get('location');
    if (!location) throw new Error(`Feed returned HTTP ${response.status} with no location`);

    // Resolved against the CURRENT url, because a Location may be relative.
    const next = assertSafeUrl(new URL(location, target).toString());
    await resolveAndAssertPublic(next.hostname);

    if (next.origin !== target.origin && sent.Authorization) {
      const { Authorization: _dropped, ...rest } = sent;
      sent = rest;
    }
    target = next;
  }

  throw new Error(`Feed redirected more than ${MAX_REDIRECTS} times`);
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * Upsert one listing. Returns true when the row was new.
 *
 * A repeat listing is UPDATED rather than ignored, because a board edits a
 * posting in place — the title changes, the salary appears, the description is
 * rewritten — and a scraper that only ever inserts serves the first version it
 * ever saw forever. `publishedAt` is left alone on update so "when did we first
 * see this" survives an edit.
 */
async function writeListing(
  db: Db, tenantId: number, connectionId: number, listing: SourcedListing,
): Promise<boolean> {
  const slug = await listingSlug(listing);

  const body = {
    company: listing.company,
    location: listing.location,
    url: listing.url,
    jobType: listing.jobType,
    sourceConnectionId: connectionId,
  };

  const [row] = await db.insert(catalogItems).values({
    tenantId,
    kind: JOB_LISTING_KIND,
    slug,
    name: listing.title.slice(0, 200),
    summary: listing.description.slice(0, 4000),
    body,
    category: listing.jobType || null,
    // Tenant-visible, not public: these are somebody else's postings collected
    // for one workspace, and republishing them on a public catalogue page is a
    // decision no operator has made.
    visibility: 'tenant',
    publisherRef: `connection:${connectionId}`,
    publishedAt: new Date(),
  }).onConflictDoUpdate({
    target: [catalogItems.tenantId, catalogItems.kind, catalogItems.slug],
    set: {
      name: listing.title.slice(0, 200),
      summary: listing.description.slice(0, 4000),
      body,
      category: listing.jobType || null,
      updatedAt: new Date(),
    },
  }).returning({ createdAt: catalogItems.createdAt, updatedAt: catalogItems.updatedAt });

  // Both branches return a row, so "was it new" is the timestamps agreeing —
  // an insert stamps them identically, an update moves only `updatedAt`.
  if (!row) return false;
  return row.createdAt.getTime() === row.updatedAt.getTime();
}

// ── Sync state ─────────────────────────────────────────────────────────────

async function markRunning(db: Db, tenantId: number, connectionId: number): Promise<void> {
  await db.insert(syncStates).values({
    tenantId, connectionId, resource: JOB_BOARD_RESOURCE,
    status: 'running', lastRunAt: new Date(),
  }).onConflictDoUpdate({
    target: [syncStates.tenantId, syncStates.connectionId, syncStates.resource],
    set: { status: 'running', lastRunAt: new Date(), updatedAt: new Date() },
  });
}

async function markSuccess(
  db: Db, tenantId: number, connectionId: number, result: SourceSyncResult,
): Promise<void> {
  const now = new Date();
  await db.update(syncStates).set({
    status: 'idle',
    lastSuccessAt: now,
    lastError: null,
    // Cumulative across runs, which is what the primitive's names mean —
    // `recordsSeen`, not `recordsSeenThisRun`. The per-run figures are in the
    // activity row.
    recordsSeen: sql`${syncStates.recordsSeen} + ${result.fetched}`,
    recordsWritten: sql`${syncStates.recordsWritten} + ${result.written}`,
    updatedAt: now,
  }).where(syncStateRow(tenantId, connectionId));

  await db.update(connections)
    .set({ lastSyncedAt: now, lastError: null, status: 'connected', updatedAt: now })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId)));
}

async function markFailed(
  db: Db, tenantId: number, connectionId: number, error: string,
): Promise<void> {
  const now = new Date();
  await db.update(syncStates)
    .set({ status: 'error', lastError: error.slice(0, 1000), updatedAt: now })
    .where(syncStateRow(tenantId, connectionId));

  // The connection stays `connected`: a feed that 500s is not a revoked grant,
  // and marking it revoked would tell the operator to reconnect something that
  // is not disconnected. The error is what they need to see.
  await db.update(connections)
    .set({ lastError: error.slice(0, 1000), updatedAt: now })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId)));
}

function syncStateRow(tenantId: number, connectionId: number) {
  return scopedToTenant(
    syncStates, tenantId,
    and(eq(syncStates.connectionId, connectionId), eq(syncStates.resource, JOB_BOARD_RESOURCE))!,
  );
}

// ── The sweep ──────────────────────────────────────────────────────────────

export interface SourcingSweepResult {
  sourcesChecked: number;
  written: number;
  failed: number;
}

/**
 * Every active feed on the platform, one pass.
 *
 * Sequential rather than `Promise.allSettled` over all of them — which is what
 * the source product did. A parallel fan-out over an unbounded number of
 * operator-supplied URLs is an outbound burst this platform cannot size in
 * advance and that reads, from the far end, as an attack. Sequential is slower
 * and is the version that can run on a schedule without anyone tuning it.
 */
export async function runSourcingSweep(db: Db, env: Env): Promise<SourcingSweepResult> {
  const result: SourcingSweepResult = { sourcesChecked: 0, written: 0, failed: 0 };

  // DECLARED cross-tenant: sourcing is a platform-wide obligation and a sweep
  // scoped to one tenant would refresh one workspace's board and stall the rest.
  const rows = await db.select({
    id: connections.id, tenantId: connections.tenantId, config: connections.config,
  })
    .from(connections)
    .where(acrossTenants(
      connections, 'scheduled_sweep',
      and(
        eq(connections.capability, JOB_BOARD_CAPABILITY),
        eq(connections.status, 'connected'),
      )!,
    ));

  for (const row of rows) {
    const config = (row.config ?? {}) as SourceConfig;
    if (!config.url) continue;
    result.sourcesChecked += 1;
    const outcome = await syncJobSource(db, env, {
      id: row.id, tenantId: row.tenantId, config,
    });
    result.written += outcome.written;
    if (outcome.error) result.failed += 1;
  }

  return result;
}

/** The sweep's log line, or null when nothing moved. */
export function describeSourcingSweep(result: SourcingSweepResult): string | null {
  if (result.sourcesChecked === 0) return null;
  return `sources=${result.sourcesChecked} written=${result.written} failed=${result.failed}`;
}
