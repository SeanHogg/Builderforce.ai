/**
 * Traffic telemetry for published sites — turning "we shipped it" into "people
 * used it".
 *
 * Publishing already auto-provisioned a QA target, so a site could be TESTED the
 * moment it went live; nothing counted a single request, so the outcome ledger
 * recorded `deliverables_completed` at publish and then went silent forever. A
 * campaign pointed at the site had nothing to attribute to.
 *
 * WHY A BUFFER, NOT A ROW PER REQUEST
 * The hosting middleware is the hottest path in the worker and it serves every
 * asset, not just pages. A write per request would (a) add database latency to
 * static asset delivery and (b) dominate the Neon bill on the free tier. So this
 * accumulates counts in the isolate and flushes an ADDITIVE upsert
 * (`page_views = page_views + excluded.page_views`), which is correct under
 * concurrent isolates because addition commutes.
 *
 * THE HONEST LIMITATION
 * An isolate evicted before its flush loses at most `maxPending` counts, and
 * `visitors` is per-isolate so two isolates can each count the same person. Both
 * are documented here, surfaced as "approximate" in the UI, and bounded — this
 * is a usage signal, not a billing meter. It is never presented as exact.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites, siteTrafficDaily } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { sha256Fingerprint } from '../../infrastructure/crypto/digest';

/** One site's pending counts for one UTC day. */
export interface TrafficDelta {
  siteId: number;
  tenantId: number;
  projectId: number;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  pageViews: number;
  assetHits: number;
  visitors: number;
  bytesServed: number;
}

/** The UTC calendar day a timestamp falls in. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Is this request a page view (a person arriving) rather than an asset fetch?
 *
 * A "view" is a request the SPA/document responds to: the site root, a
 * client-side route with no file extension, or an explicit `.html`. Everything
 * with a file extension is an asset. This is the same rule the SPA fallback in
 * `serveHostedSite` uses to decide whether to serve the index document, so the
 * two cannot disagree about what a page is.
 */
export function isPageView(assetPath: string): boolean {
  const rel = assetPath.replace(/^\/+/, '');
  if (!rel) return true;
  const ext = /\.([a-z0-9]+)$/i.exec(rel)?.[1]?.toLowerCase();
  if (!ext) return true;
  return ext === 'html' || ext === 'htm';
}

/**
 * A stable per-day visitor fingerprint. Salted and hashed, never reversible, and
 * rotated daily by folding the date in — so it cannot be used to track a person
 * across days even by us.
 */
export async function visitorHash(
  salt: string,
  ip: string | undefined,
  userAgent: string | undefined,
  day: string,
): Promise<string> {
  const material = `${salt}|${day}|${ip ?? ''}|${userAgent ?? ''}`;
  // 32 hex chars — the same 16 BYTES this has always kept, now stated as a
  // collision budget rather than as a slice on the byte array.
  return sha256Fingerprint(material, 32);
}

/** The salt used for visitor hashing. Dedicated secret preferred so rotating it
 *  cannot invalidate sessions; falls back so the feature works un-provisioned. */
export function visitorSalt(env: Env): string {
  return env.SITE_VISITOR_SALT ?? env.JWT_SECRET;
}

export interface TrafficBufferOptions {
  /** Flush once this many requests are pending across all sites. */
  maxPending?: number;
  /** Flush when the oldest pending count is at least this old (ms). */
  maxAgeMs?: number;
  /** Cap on remembered visitor hashes per site/day, bounding isolate memory. */
  maxVisitorHashes?: number;
  /** Injected clock so the age rule is testable without waiting. */
  now?: () => number;
}

/**
 * In-isolate accumulator. Extracted as a class with injected time so the
 * batching rules — the part most likely to silently lose data — are directly
 * unit-testable rather than only observable in production.
 */
export class SiteTrafficBuffer {
  private pending = new Map<string, TrafficDelta>();
  private seenVisitors = new Map<string, Set<string>>();
  private oldestAt: number | null = null;
  private readonly maxPending: number;
  private readonly maxAgeMs: number;
  private readonly maxVisitorHashes: number;
  private readonly now: () => number;

  constructor(opts: TrafficBufferOptions = {}) {
    this.maxPending = opts.maxPending ?? 25;
    this.maxAgeMs = opts.maxAgeMs ?? 10_000;
    this.maxVisitorHashes = opts.maxVisitorHashes ?? 2_000;
    this.now = opts.now ?? Date.now;
  }

  /** Total requests recorded but not yet flushed. */
  get pendingCount(): number {
    let total = 0;
    for (const d of this.pending.values()) total += d.pageViews + d.assetHits;
    return total;
  }

  /**
   * Record one served request. `visitor` is the per-day hash, or undefined when
   * visitor counting is unavailable. Returns true when the caller should flush.
   */
  record(input: {
    siteId: number;
    tenantId: number;
    projectId: number;
    day: string;
    pageView: boolean;
    bytes: number;
    visitor?: string;
  }): boolean {
    const key = `${input.siteId}:${input.day}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = {
        siteId: input.siteId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        day: input.day,
        pageViews: 0,
        assetHits: 0,
        visitors: 0,
        bytesServed: 0,
      };
      this.pending.set(key, entry);
    }
    if (input.pageView) entry.pageViews += 1;
    else entry.assetHits += 1;
    entry.bytesServed += Math.max(0, input.bytes);

    if (input.visitor) {
      let seen = this.seenVisitors.get(key);
      if (!seen) {
        seen = new Set<string>();
        this.seenVisitors.set(key, seen);
      }
      // Past the cap we stop counting new visitors rather than growing without
      // bound — undercounting is the safe direction for an approximate metric.
      if (!seen.has(input.visitor) && seen.size < this.maxVisitorHashes) {
        seen.add(input.visitor);
        entry.visitors += 1;
      }
    }

    if (this.oldestAt === null) this.oldestAt = this.now();
    return this.shouldFlush();
  }

  /** True when either the size or the age rule is met. */
  shouldFlush(): boolean {
    if (this.pendingCount >= this.maxPending) return true;
    return this.oldestAt !== null && this.now() - this.oldestAt >= this.maxAgeMs;
  }

  /**
   * Remove and return everything pending. Visitor hashes are deliberately KEPT
   * across a drain: forgetting them would re-count the same person on the next
   * batch, which would inflate `visitors` without bound on a busy site.
   */
  drain(): TrafficDelta[] {
    const out = [...this.pending.values()];
    this.pending.clear();
    this.oldestAt = null;
    return out;
  }
}

/** The process-wide buffer the hosting middleware feeds. */
let sharedBuffer: SiteTrafficBuffer | null = null;

export function sharedTrafficBuffer(): SiteTrafficBuffer {
  if (!sharedBuffer) sharedBuffer = new SiteTrafficBuffer();
  return sharedBuffer;
}

/**
 * Persist a batch of deltas. ONE statement for the whole batch, additive on
 * conflict — concurrent isolates flushing the same site/day sum correctly
 * instead of clobbering each other.
 */
export async function flushTrafficDeltas(db: Db, deltas: TrafficDelta[]): Promise<number> {
  if (deltas.length === 0) return 0;
  await db
    .insert(siteTrafficDaily)
    .values(
      deltas.map((d) => ({
        siteId: d.siteId,
        tenantId: d.tenantId,
        projectId: d.projectId,
        day: d.day,
        pageViews: d.pageViews,
        assetHits: d.assetHits,
        visitors: d.visitors,
        bytesServed: d.bytesServed,
      })),
    )
    .onConflictDoUpdate({
      target: [siteTrafficDaily.siteId, siteTrafficDaily.day],
      set: {
        pageViews: sql`${siteTrafficDaily.pageViews} + excluded.page_views`,
        assetHits: sql`${siteTrafficDaily.assetHits} + excluded.asset_hits`,
        visitors: sql`${siteTrafficDaily.visitors} + excluded.visitors`,
        bytesServed: sql`${siteTrafficDaily.bytesServed} + excluded.bytes_served`,
        updatedAt: sql`NOW()`,
      },
    });
  return deltas.length;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface TrafficDay {
  day: string;
  pageViews: number;
  assetHits: number;
  visitors: number;
  bytesServed: number;
}

export interface SiteTrafficSummary {
  /** Newest-first daily series, one entry per day WITH traffic. */
  days: TrafficDay[];
  totals: { pageViews: number; visitors: number; assetHits: number; bytesServed: number };
  /** Always true — see the class docs. The UI must label the numbers. */
  approximate: true;
}

function trafficCacheKey(projectId: number, windowDays: number): string {
  return `site-traffic:${projectId}:${windowDays}`;
}

/**
 * Daily traffic for a project's site over the last `windowDays`.
 *
 * Read-through cached: a dashboard load must not aggregate on every request, and
 * the underlying counts are append-only rollups that tolerate a short TTL. The
 * TTL is deliberately shorter than the ledger's because a user who just shared
 * their link will refresh to watch the number move.
 */
export async function getSiteTraffic(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  windowDays = 30,
): Promise<SiteTrafficSummary> {
  const days = Math.min(Math.max(1, Math.trunc(windowDays)), 365);
  return getOrSetCached<SiteTrafficSummary>(
    env,
    trafficCacheKey(projectId, days),
    async () => {
      const since = utcDay(Date.now() - days * 86_400_000);
      const rows = await db
        .select({
          day: siteTrafficDaily.day,
          pageViews: siteTrafficDaily.pageViews,
          assetHits: siteTrafficDaily.assetHits,
          visitors: siteTrafficDaily.visitors,
          bytesServed: siteTrafficDaily.bytesServed,
        })
        .from(siteTrafficDaily)
        .where(
          and(
            eq(siteTrafficDaily.tenantId, tenantId),
            eq(siteTrafficDaily.projectId, projectId),
            gte(siteTrafficDaily.day, since),
          ),
        )
        .orderBy(desc(siteTrafficDaily.day))
        .limit(days);

      const totals = rows.reduce(
        (acc, r) => ({
          pageViews: acc.pageViews + r.pageViews,
          visitors: acc.visitors + r.visitors,
          assetHits: acc.assetHits + r.assetHits,
          bytesServed: acc.bytesServed + Number(r.bytesServed ?? 0),
        }),
        { pageViews: 0, visitors: 0, assetHits: 0, bytesServed: 0 },
      );
      return {
        days: rows.map((r) => ({ ...r, bytesServed: Number(r.bytesServed ?? 0) })),
        totals,
        approximate: true as const,
      };
    },
    { kvTtlSeconds: 120 },
  );
}

/** Invalidate the cached summary (called when a flush lands for this project). */
export async function invalidateSiteTraffic(env: Env, projectId: number): Promise<void> {
  // Both window sizes the UI asks for; the keyspace is small and enumerable, so
  // a version token would be more machinery than the problem needs.
  await Promise.all(
    [7, 30, 90].map((w) => invalidateCached(env, trafficCacheKey(projectId, w))),
  );
}

/**
 * Resolve the site row for a project (for routes that hold a projectId and need
 * the site id). Tenant-scoped, so a foreign project id resolves to null.
 */
export async function siteForProject(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<{ siteId: number; subdomain: string; customDomain: string | null } | null> {
  const [row] = await db
    .select({
      siteId: projectSites.id,
      subdomain: projectSites.subdomain,
      customDomain: projectSites.customDomain,
    })
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}
