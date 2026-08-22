/**
 * READING THE SOURCED CATALOGUE — the query behind `GET /api/sourcing/listings`.
 *
 * ── WHY THIS IS NOT IN THE ROUTE ─────────────────────────────────────────────
 * It was, and that was a layering violation the build guard caught: a route may
 * not import a TABLE or the cache — presentation depends on the application
 * layer, and the application layer owns storage. A handler holding a `select()`
 * is also the shape that makes a query unreachable from anywhere else, so the
 * MCP tool and the canvas widget that want the same listings would each grow
 * their own copy of it.
 *
 * ── THE CACHE IS VERSION-TOKENED, AND THE WRITER OWNS THE TOKEN ──────────────
 * The key carries the tenant, the query and the limit, which makes the keyspace
 * unbounded — a member can type anything. So invalidation is a single bump of
 * `listingsVersionKey`, performed by the SWEEP (`runSourcingSweep`), and every
 * cached answer under the previous token is orphaned at once. Enumerating keys
 * to delete them is not possible here and pretending otherwise would leave most
 * queries serving pre-sweep rows until their TTL expired.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { JOB_LISTING_KIND, listingsVersionKey } from './runSourcingSweep';

const TTL_SECONDS = 120;

/** How many rows are scanned when a query is present. Bounded, because a filter
 *  applied over an unbounded scan is a full table read per keystroke. */
const SEARCH_SCAN = 500;

export interface SourcedJobListing {
  id: string;
  title: string;
  summary: string;
  company: string;
  location: string;
  url: string;
  jobType: string;
  seenAt: string;
}

export async function listSourcedListings(
  db: Db, env: Env,
  input: { tenantId: number; q?: string; limit?: number },
): Promise<SourcedJobListing[]> {
  const q = (input.q ?? '').trim().toLowerCase().slice(0, 80);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const version = await getCacheVersion(env, listingsVersionKey(input.tenantId));
  return getOrSetCached(
    env,
    `sourcing:listings:v:${version}:t:${input.tenantId}:q:${q}:n:${limit}`,
    async () => {
      const rows = await db.select({
        id: catalogItems.id,
        name: catalogItems.name,
        summary: catalogItems.summary,
        body: catalogItems.body,
        category: catalogItems.category,
        publishedAt: catalogItems.publishedAt,
        updatedAt: catalogItems.updatedAt,
      })
        .from(catalogItems)
        .where(and(
          eq(catalogItems.tenantId, input.tenantId),
          eq(catalogItems.kind, JOB_LISTING_KIND),
        ))
        .orderBy(desc(catalogItems.publishedAt))
        // A wider scan when filtering, because applying the filter to one page
        // would drop matches that sit past it — a listing that exists, that the
        // operator searched for, and that the product says is not there.
        .limit(q ? SEARCH_SCAN : limit);

      const matched = q
        ? rows.filter((row) => `${row.name} ${row.summary ?? ''}`.toLowerCase().includes(q))
        : rows;

      return matched.slice(0, limit).map((row): SourcedJobListing => {
        const body = (row.body ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          title: row.name,
          summary: row.summary ?? '',
          company: String(body.company ?? ''),
          location: String(body.location ?? ''),
          url: String(body.url ?? ''),
          jobType: row.category ?? '',
          seenAt: (row.publishedAt ?? row.updatedAt).toISOString(),
        };
      });
    },
    { kvTtlSeconds: TTL_SECONDS },
  );
}
