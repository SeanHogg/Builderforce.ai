/**
 * The public startup directory's cache keys.
 *
 * One version token for the whole directory: a listing keyspace is unbounded
 * (every filter combination is a key), so a founder's write bumps the token and
 * orphans every page at once rather than enumerating them — the pattern
 * `getCacheVersion` documents. Held in its own module so the WRITER
 * (`startupListing.ts`) and the READER (`startupDirectory.ts`) import the same
 * name without importing each other.
 */

export const STARTUP_DIRECTORY_VERSION_KEY = 'startup-directory';

export const startupBrowseCacheKey = (version: string, filterHash: string): string =>
  `startups:browse:v1:${version}:${filterHash}`;

export const startupProfileCacheKey = (version: string, slug: string): string =>
  `startups:profile:v1:${version}:${slug}`;

/** Twelve hours. The version token, not the TTL, is what keeps a card current. */
export const STARTUP_DIRECTORY_TTL_SECONDS = 43_200;
