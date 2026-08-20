/**
 * The developer context's SHARED reads and cache keys.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * `loadPackage`, `loadVersion` and the install-cache invalidator were defined in
 * `extensionPackages.ts` and `extensionInstalls.ts` and used by BOTH, which made
 * the installs module import the packages module. That was harmless while those
 * were the only two files in the context. It stopped being harmless the moment
 * the review pipeline arrived: the dynamic stage resolves a manifest through
 * `connectorRegistry`, which reads `extensionInstalls`, which read
 * `extensionPackages` — so a packages module that reached the stages would close
 * a cycle through three other bounded contexts.
 *
 * The answer is not to leave the cycle and hope the bundler copes with it. It is
 * that the shared bottom of this context — "read a package by id, read a version
 * by id, drop the caches a write invalidates" — was never the packages SERVICE's
 * to own. It is a leaf, and it imports nothing from this context at all.
 *
 * ── THE CACHE KEYS ARE HERE FOR THE SAME REASON THEY ARE TOGETHER ───────────
 * An install changes an install list AND a listing's rank in the public
 * directory, because `install_count` is a ranking signal. A publish changes the
 * catalogue AND every cached search over it. Keys that must be dropped together
 * belong in one function, or the second one is the one somebody forgets — which
 * is the argument `invalidateConnectorCatalog` already makes about the action
 * catalog, applied to a keyspace that now includes search.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { extensionPackages, extensionVersions } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { PublisherError } from './publishers';

export type PackageRow = typeof extensionPackages.$inferSelect;
export type VersionRow = typeof extensionVersions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Cache keys
// ─────────────────────────────────────────────────────────────────────────────

/** The whole listed catalogue, unfiltered — the projection `/integrations` reads. */
export const CATALOG_CACHE_KEY = 'developer:catalog:listed';

/**
 * The version token every SEARCH result is keyed under.
 *
 * A search key is `query × category × kind × page`, which is unbounded — there is
 * no enumerating it to invalidate, and a per-key TTL alone would serve a delisted
 * package for its full lifetime. Folding a version token into the key orphans the
 * entire keyspace with one write, which is the same trick `policyPackService` uses
 * for its (project × agent) resolutions and the one PRD 24 §5.7 asks for by name.
 */
export const CATALOG_VERSION_KEY = 'developer:catalog:version';

export const installsCacheKey = (tenantId: number): string => `extension-installs:${tenantId}`;

export async function catalogVersion(env: Env): Promise<string> {
  return getCacheVersion(env, CATALOG_VERSION_KEY);
}

/**
 * The public catalogue went stale — a publish, a delist, a suspension.
 *
 * Drops the unfiltered catalogue AND orphans every cached search over it. Doing
 * one without the other would leave a just-published package invisible to search
 * while it was visible on `/integrations`, which reads to a publisher as the
 * listing having half-worked.
 */
export async function invalidatePublicCatalog(env: Env): Promise<void> {
  await Promise.all([
    invalidateCached(env, CATALOG_CACHE_KEY),
    bumpCacheVersion(env, CATALOG_VERSION_KEY),
  ]);
}

/**
 * Drop every cache a tenant's installs feed.
 *
 * The connector catalog is one of them: an install adds manifests to it, so
 * invalidating installs without invalidating the catalog would leave a
 * just-installed connector missing from the agent tool list for five minutes.
 *
 * The public directory is another, and that one is easy to miss: `install_count`
 * is a ranking signal, so an install changes where OTHER people see this listing.
 * The publisher's own analytics read is versioned off the same token.
 */
export async function invalidateInstalls(env: Env, tenantId: number): Promise<void> {
  await Promise.all([
    invalidateCached(env, installsCacheKey(tenantId)),
    invalidateCached(env, `connectors:catalog:${tenantId}`),
    invalidateCached(env, `connector-action-catalog:${tenantId}`),
    invalidateCached(env, `mcp-tools:tenant:${tenantId}`),
    bumpCacheVersion(env, CATALOG_VERSION_KEY),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
//
// A package is addressed by its PRIMARY KEY and is not filtered by the caller's
// tenant, because the two callers who load one are the publisher (who owns it)
// and an installing tenant (who does not) — the whole point of a catalogue. So
// the read declares itself cross-tenant and the AUTHORITY check follows it:
// `requirePublisher(db, pkg.tenantId, …)` for a write, `listingState = 'listed'`
// for an install. Filtering here instead would break installing altogether.
// ─────────────────────────────────────────────────────────────────────────────

export async function loadPackage(db: Db, packageId: string): Promise<PackageRow> {
  const [row] = await db
    .select()
    .from(extensionPackages)
    .where(acrossTenants(extensionPackages, 'public_catalogue', eq(extensionPackages.id, packageId)))
    .limit(1);
  if (!row) throw new PublisherError('package not found', 404);
  return row;
}

export async function loadVersion(db: Db, versionId: string): Promise<VersionRow> {
  const [row] = await db.select().from(extensionVersions).where(eq(extensionVersions.id, versionId)).limit(1);
  if (!row) throw new PublisherError('version not found', 404);
  return row;
}

/** Load many packages by id in one round-trip. Used by the install list. */
export async function loadPackagesByIds(db: Db, ids: string[]): Promise<Map<string, PackageRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(extensionPackages)
    .where(acrossTenants(extensionPackages, 'public_catalogue', inArray(extensionPackages.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}
