/**
 * Where Spawn's pages and downloads are. Paths, not the subdomain: `/spawn`
 * resolves on the apex, on `spawn.builderforce.ai` (whose root redirects here —
 * `lib/productHosts.ts`) and on localhost alike.
 */
export const SPAWN_ROUTE = '/spawn';
export const SPAWN_ACCOUNT_ROUTE = '/spawn/account';

/** Releases of the Spawn desktop app carry `spawn-v*` tags; this lists exactly those. */
export const SPAWN_DOWNLOAD_URL = 'https://github.com/SeanHogg/Builderforce.ai/releases?q=spawn-v&expanded=true';

/** The story behind Spawn on the blog. */
export const SPAWN_POST_PATH = '/blog/build-roblox-games-by-talking';
