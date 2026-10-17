import { openSourceBySlug } from '@/lib/openSourcePackages';

/**
 * Where Spawn's pages and downloads are. Paths, not the subdomain: `/spawn`
 * resolves on the apex, on `spawn.builderforce.ai` (whose root redirects here —
 * `lib/productHosts.ts`) and on localhost alike.
 */
export const SPAWN_ROUTE = '/spawn';
export const SPAWN_ACCOUNT_ROUTE = '/spawn/account';

/** Spawn ships from its own repository — the `builderforce-spawn` row of the open-source registry;
 *  this is its newest release. The download button's fallback — it links the installer itself once
 *  `/api/spawn/downloads` names one. */
const SPAWN_REPO_URL = openSourceBySlug('builderforce-spawn')?.repoUrl;
export const SPAWN_DOWNLOAD_URL = SPAWN_REPO_URL ? `${SPAWN_REPO_URL}/releases/latest` : '/open-source';
