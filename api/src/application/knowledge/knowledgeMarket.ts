/**
 * Knowledge marketplace reads — the shared, tenant-agnostic browse of public
 * knowledge listings (migration 0252). Extracted so BOTH the authed
 * `/api/knowledge/listings` and the PUBLIC `/api/knowledge-market/*` router serve
 * the exact same data through the exact same cache (one query, one version token),
 * and logged-out visitors can browse what is for sale.
 *
 * Reads are served through the read-through cache behind a global version token
 * bumped on every listing write (list / unlist / install).
 */
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { marketplaceKnowledge } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';

/** Global (cross-tenant) cache version token for the public listings feed. */
export const MARKET_VERSION_KEY = 'knowledge-market';

/** Parse a listing's JSON-encoded tag array defensively. */
export function parseListingTags(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface PublicListing {
  id: string;
  title: string;
  summary: string | null;
  docType: string;
  category: string | null;
  tags: string[];
  priceCents: number;
  authorName: string | null;
  installCount: number;
  createdAt: Date | null;
}

/** Browse all public listings (cross-tenant), cached behind the market version. */
export async function browsePublicListings(env: Env, db: Db): Promise<PublicListing[]> {
  const ver = await getCacheVersion(env, MARKET_VERSION_KEY);
  return getOrSetCached(
    env,
    `knowledge-market:listings:v:${ver}`,
    async () => {
      const rows = await db
        .select()
        .from(marketplaceKnowledge)
        .where(eq(marketplaceKnowledge.visibility, 'public'))
        .orderBy(desc(marketplaceKnowledge.installCount), desc(marketplaceKnowledge.createdAt));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        docType: r.docType,
        category: r.category,
        tags: parseListingTags(r.tags),
        priceCents: r.priceCents,
        authorName: r.authorName,
        installCount: r.installCount,
        createdAt: r.createdAt,
      }));
    },
    { kvTtlSeconds: 120, l1TtlMs: 30_000 },
  );
}
