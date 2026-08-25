/**
 * The public DIRECTORY — search, categories and ranked results.
 *
 * `listPublicCatalog` returns every listed package ordered by `install_count`.
 * That is the right read for the `/integrations` projection, which wants the
 * whole set and merges it onto our own ports. It is not a directory: a buyer
 * cannot narrow it, cannot search it, and cannot tell a package reviewed last
 * week from one reviewed last year. PRD 24 §2.6 argues the bottleneck in the
 * agent ecosystem is discovery and trust rather than protocol; a list you can
 * only scroll answers neither.
 *
 * Three things live here, and they are one concern — what a stranger asks the
 * catalogue:
 *
 *   • the TAXONOMY they narrow by, read from `extension_categories`;
 *   • the SEARCH over name, blurb and capability names;
 *   • the ORDER, which is `catalogRanking.rankListing` and nothing else.
 *
 * ── WHY THE MATCH IS IN SQL AND THE ORDER IS IN TYPESCRIPT ──────────────────
 * They are different kinds of question. Matching is a set operation over an
 * indexed column and belongs where the index is. Ordering is a POLICY — how much
 * a young listing's freshness is worth against an incumbent's installs — and a
 * policy expressed as an `ORDER BY` cannot be read by the publisher who wants to
 * know why they are third, cannot be unit-tested, and cannot be changed without
 * a migration-shaped conversation about a query plan. So the query decides WHICH
 * listings, and one documented pure function decides in what order.
 *
 * ── CACHING ─────────────────────────────────────────────────────────────────
 * The keyspace is `query × category × kind × page`, which is unbounded — exactly
 * the case PRD 24 §5.7 flags. Every result is keyed under the catalogue's version
 * token (`extensionRepository.CATALOG_VERSION_KEY`), which a publish, a delist, a
 * suspension or an INSTALL bumps; one bump orphans the whole keyspace rather than
 * enumerating it. An install is in that list because `install_count` is a ranking
 * signal: it changes where other people see a listing, not just its own badge.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  catalogItems,
  extensionCategories,
  extensionPackages,
  extensionReviewStages,
  extensionVersions,
  tenants,
} from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { catalogVersion } from './extensionRepository';
import { assuranceFor, rankListings, type AssuranceTier } from './catalogRanking';

// ─────────────────────────────────────────────────────────────────────────────
// The search projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The CAPABILITY names a spec advertises — the strings a buyer actually types.
 *
 * Somebody looking for "create an invoice" is looking for an ACTION, and until
 * `search_text` existed there was nowhere that string was reachable by a query:
 * actions live inside `extension_versions.spec`, a jsonb blob on another table,
 * one row per version. Branching on `kind` here is the same branch
 * `packageReview` makes and for the same reason — `kind` decides what the spec
 * MEANS, and nothing else in the context is allowed to guess.
 */
function capabilityTerms(kind: string, spec: Record<string, unknown> | null | undefined): string[] {
  if (!spec) return [];
  if (kind === 'connector') {
    const actions = Array.isArray(spec.actions) ? (spec.actions as Array<Record<string, unknown>>) : [];
    return actions.flatMap((a) => [a?.key, a?.label, a?.description].filter((v): v is string => typeof v === 'string'));
  }
  if (kind === 'mcp_server') {
    const tools = Array.isArray(spec.tools) ? (spec.tools as unknown[]) : [];
    return tools
      .map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown })?.name ?? '')))
      .filter(Boolean);
  }
  return [];
}

/**
 * Build the value stored in `extension_packages.search_text`.
 *
 * Lowercased and space-joined; punctuation is left alone because the full-text
 * index does its own lexeme splitting and the ILIKE branch wants the raw
 * substrings. Called from exactly two places — `createPackage` and
 * `publishVersion` — both of which already hold every value it needs, so this is
 * never a read that could go stale between the write and the projection.
 */
export function buildSearchText(input: {
  name: string;
  tagline?: string | null;
  description?: string | null;
  categories?: readonly string[] | null;
  kind: string;
  spec?: Record<string, unknown> | null;
}): string {
  return [
    input.name,
    input.tagline ?? '',
    input.description ?? '',
    ...(input.categories ?? []),
    ...capabilityTerms(input.kind, input.spec),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // A search projection is not a document store. Capping it keeps one verbose
    // manifest from putting a megabyte of prose into a GIN index that the whole
    // directory shares.
    .slice(0, 8_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// The taxonomy
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectoryCategory {
  key: string;
  label: string;
  description: string | null;
  position: number;
}

const CATEGORY_CACHE_KEY = 'developer:directory:categories';

/**
 * The category chips, active ones only, in `position` order.
 *
 * Cached at the deployment level rather than per tenant: the taxonomy is platform
 * configuration and is the same row for everybody, which is also why the table
 * carries no `tenant_id` (declared in `check-tenant-column`).
 */
export async function listDirectoryCategories(db: Db, env: Env): Promise<DirectoryCategory[]> {
  return getOrSetCached(
    env,
    CATEGORY_CACHE_KEY,
    async () => {
      const rows = await db
        .select()
        .from(extensionCategories)
        .where(eq(extensionCategories.active, true))
        .orderBy(asc(extensionCategories.position), asc(extensionCategories.key));
      return rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        position: r.position,
      }));
    },
    { kvTtlSeconds: 900, l1TtlMs: 300_000 },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectoryQuery {
  /** Free text. Empty or absent = browse. */
  query?: string | null;
  /** One `extension_categories.key`. */
  category?: string | null;
  /** One `EXTENSION_KINDS` value. */
  kind?: string | null;
  limit?: number;
  offset?: number;
}

export interface DirectoryListing {
  id: string;
  slug: string;
  kind: string;
  name: string;
  tagline: string;
  description: string | null;
  categories: string[];
  iconUrl: string | null;
  docsUrl: string | null;
  installCount: number;
  publisher: { slug: string; name: string; state: string } | null;
  semver: string | null;
  /** When the head version passed review and was published. The freshness signal. */
  reviewedAt: string | null;
  /** How far through the pipeline the head version got. The trust badge. */
  assurance: AssuranceTier;
  /**
   * The cheapest RECURRING price, or null when the listing is free (and also
   * when every plan is pure usage-based, which genuinely has no entry price —
   * see `fromCentsOf`). A directory that quoted a $0/month metered plan as
   * "from free" would be the single most common way a marketplace listing lies.
   */
  fromCents: number | null;
  currency: string;
  /** True when the listing has any plan at all. Distinct from `fromCents`
   *  being set, because a usage-only listing is paid and has no "from". */
  paid: boolean;
  /** The publisher holds a Featured slot. A placement TIER, not a score —
   *  see `ListingSignals.featured`. Returned so the badge and the order agree. */
  featured: boolean;
  /** 0..1, from `catalogRanking.rankListing`. Returned so the order is auditable. */
  score: number;
}

export interface DirectoryResult {
  listings: DirectoryListing[];
  /** Matches before paging, so a caller can page without a second query. */
  total: number;
  categories: DirectoryCategory[];
}

const MAX_LIMIT = 60;

/** Normalize the request into the cache key AND the query, so they cannot differ. */
function normalizeQuery(input: DirectoryQuery): Required<Omit<DirectoryQuery, 'query' | 'category' | 'kind'>> & {
  query: string; category: string; kind: string;
} {
  return {
    query: (input.query ?? '').trim().slice(0, 120).toLowerCase(),
    category: (input.category ?? '').trim().slice(0, 48),
    kind: (input.kind ?? '').trim().slice(0, 32),
    limit: Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit ?? 24))),
    offset: Math.max(0, Math.trunc(input.offset ?? 0)),
  };
}

/**
 * Search the public directory.
 *
 * The text predicate is TWO branches OR'd together, and both earn their place:
 *
 *   • `websearch_to_tsquery` over the GIN-indexed `to_tsvector` — this is the
 *     one that stems, so "invoices" finds "invoice" and "creating" finds
 *     "create". It is the match a directory actually needs.
 *   • a plain `ILIKE '%q%'` — because a lexeme index cannot serve a PREFIX or an
 *     infix. Somebody typing "payr" gets nothing from full text and everything
 *     they wanted from this. It is unindexed and therefore only tolerable
 *     because the listed catalogue is small and the result is cached; if it ever
 *     stops being small the answer is a trigram index, not a wider tsquery.
 *
 * `pg_trgm` was deliberately not used: `CREATE EXTENSION` in a migration is a red
 * deploy on any deployment whose role cannot create it, and the behaviour it
 * would have bought is the one the ILIKE branch already covers at this size.
 */
export async function searchDirectory(db: Db, env: Env, input: DirectoryQuery): Promise<DirectoryResult> {
  const q = normalizeQuery(input);
  const version = await catalogVersion(env);
  const key = `developer:directory:v${version}:${q.query}|${q.category}|${q.kind}|${q.limit}|${q.offset}`;

  return getOrSetCached(
    env,
    key,
    async () => {
      const predicates: Array<SQL | undefined> = [
        eq(extensionPackages.listingState, 'listed'),
        sql`${tenants.publisherSuspendedAt} is null`,
      ];
      if (q.kind) predicates.push(eq(extensionPackages.kind, q.kind));
      // `@>` on a jsonb array is an exact-element containment test — the only
      // correct one here, because a category key is an identity and `ILIKE
      // '%finance%'` would also match a package filed under 'finance-ops'.
      if (q.category) {
        predicates.push(sql`${extensionPackages.categories} @> ${JSON.stringify([q.category])}::jsonb`);
      }
      if (q.query) {
        predicates.push(or(
          sql`to_tsvector('english', coalesce(${extensionPackages.searchText}, '')) @@ websearch_to_tsquery('english', ${q.query})`,
          sql`coalesce(${extensionPackages.searchText}, '') like ${`%${q.query}%`}`,
        ));
      }

      const relevance = q.query
        ? sql<number>`ts_rank(to_tsvector('english', coalesce(${extensionPackages.searchText}, '')), websearch_to_tsquery('english', ${q.query}))`
        : sql<number>`0`;

      const rows = await db
        .select({
          pkg: extensionPackages,
          publisher: tenants,
          headSemver: extensionVersions.semver,
          headPublishedAt: extensionVersions.publishedAt,
          headId: extensionVersions.id,
          // The commercial half of a listing, from the row that owns it. LEFT
          // joined because most listings are free and have no catalogue row at
          // all — an INNER join here would quietly delete every free package
          // from the directory.
          listingPriceCents: catalogItems.priceCents,
          listingCurrency: catalogItems.currency,
          listingVisibility: catalogItems.visibility,
          relevance,
        })
        .from(extensionPackages)
        .innerJoin(tenants, eq(tenants.id, extensionPackages.tenantId))
        .leftJoin(catalogItems, eq(catalogItems.id, extensionPackages.catalogItemId))
        // LEFT, not INNER: a listing whose head row somehow went missing must
        // still appear (scored as never-reviewed) rather than silently vanish
        // from the directory with no way for anyone to notice.
        .leftJoin(extensionVersions, eq(extensionVersions.id, extensionPackages.currentVersionId))
        .where(acrossTenants(extensionPackages, 'public_catalogue', and(...predicates)))
        // A bounded read, then ranked in memory. The cap is deliberately much
        // larger than a page: ranking a page's worth would let a listing that the
        // database happened to return 200th never be scored at all.
        .orderBy(desc(extensionPackages.installCount))
        .limit(400);

      // ── The assurance tier, from the stage record ────────────────────────
      const headIds = rows.map((r) => r.headId).filter((v): v is string => typeof v === 'string');
      const stageRows = headIds.length
        ? await db
            .select({
              versionId: extensionReviewStages.versionId,
              stage: extensionReviewStages.stage,
              verdict: extensionReviewStages.verdict,
            })
            .from(extensionReviewStages)
            .where(inArray(extensionReviewStages.versionId, headIds))
        : [];
      const verdictsByVersion = new Map<string, Record<string, string>>();
      for (const s of stageRows) {
        const bucket = verdictsByVersion.get(s.versionId) ?? {};
        bucket[s.stage] = s.verdict;
        verdictsByVersion.set(s.versionId, bucket);
      }

      // ts_rank is unbounded-ish and tiny; the ranking function wants 0..1. It is
      // normalized against the best match IN THIS RESULT SET, which is the only
      // scale that means anything — a relevance of 0.06 is high or low only
      // relative to what else matched the same words.
      const maxRelevance = Math.max(0, ...rows.map((r) => Number(r.relevance) || 0));
      const mode = q.query ? 'search' : 'browse';

      const ranked = rankListings(
        rows.map((r) => ({
          key: r.pkg.slug,
          row: r,
          signals: {
            installs: r.pkg.installCount,
            reviewedAt: r.headPublishedAt ?? null,
            assurance: assuranceFor({
              approved: Boolean(r.headId),
              stageVerdicts: (r.headId && verdictsByVersion.get(r.headId)) || {},
            }),
            relevance: maxRelevance > 0 ? (Number(r.relevance) || 0) / maxRelevance : 0,
            featured: r.publisher.publisherFeaturedAt !== null,
          },
        })),
        mode,
      );

      const page = ranked.slice(q.offset, q.offset + q.limit);
      const categories = await listDirectoryCategories(db, env);

      return {
        total: ranked.length,
        categories,
        listings: page.map(({ row, signals, score }): DirectoryListing => ({
          id: row.pkg.id,
          slug: row.pkg.slug,
          kind: row.pkg.kind,
          name: row.pkg.name,
          tagline: row.pkg.tagline,
          description: row.pkg.description,
          categories: row.pkg.categories ?? [],
          iconUrl: row.pkg.iconUrl,
          docsUrl: row.pkg.docsUrl,
          installCount: row.pkg.installCount,
          publisher: { slug: row.publisher.slug, name: row.publisher.name, state: row.publisher.publisherState },
          semver: row.headSemver ?? null,
          reviewedAt: row.headPublishedAt ? new Date(row.headPublishedAt).toISOString() : null,
          assurance: signals.assurance,
          // Read from the price list already joined above rather than from a
          // second query per row: a directory page that fanned out one
          // `catalog_items` lookup per listing would be 24 round-trips for one
          // screen.
          fromCents: row.listingPriceCents ?? null,
          currency: row.listingCurrency ?? 'USD',
          paid: row.listingVisibility === 'public',
          featured: signals.featured === true,
          score: Number(score.toFixed(4)),
        })),
      } satisfies DirectoryResult;
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}
