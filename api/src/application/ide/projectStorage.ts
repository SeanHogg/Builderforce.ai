/**
 * Reclaiming the object storage a project owns when the project is deleted.
 *
 * Deleting a project removed its rows and left every byte it had ever written in
 * R2: the whole canvas (`ide/projects/<id>/…`) and, for a published project, the
 * built site (`sites/<subdomain>/…`). Nothing referenced those keys afterwards,
 * so nothing would ever delete them — the bucket only grew, and a deleted
 * project's source was still sitting there.
 *
 * Two prefixes, resolved separately for a reason: the canvas prefix is derived
 * from the project id and is therefore always knowable, while the site prefix
 * lives on the `project_sites` row and disappears with it. That is why this is a
 * plan/run pair rather than one call — see {@link ProjectStoragePurge}.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { projectSites } from '../../infrastructure/database/schema';
import type { ProjectStoragePurge } from '../project/ProjectService';
import { invalidateCustomDomain, invalidateSite } from './siteHosting';
import { workspacePrefix } from './workspaceStore';

/** R2 deletes at most 1000 keys per call, and `list` pages at 1000. */
const PAGE = 1000;

/**
 * Delete every object under one prefix, paging until the prefix is empty.
 *
 * Bounded by {@link MAX_PAGES} rather than looping until R2 says it is done: a
 * list that kept reporting `truncated` — a bug, or a project being written to
 * while it is deleted — would otherwise spin the isolate until it was killed.
 * Stopping early leaves an orphan, which is the same failure this fixes but
 * smaller, and is strictly better than a Worker that never returns.
 */
const MAX_PAGES = 200;

export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await bucket.list({ prefix, limit: PAGE, ...(cursor ? { cursor } : {}) });
    const keys = (listed.objects ?? []).map((o) => o.key);
    if (keys.length) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
    if (!cursor) break;
  }
  return deleted;
}

/**
 * The purge port, bound to this deployment's bucket.
 *
 * Returns null when no bucket is configured, so the caller wires nothing rather
 * than wiring something that silently does nothing.
 */
export function r2ProjectStoragePurge(env: Env & { UPLOADS?: R2Bucket }): ProjectStoragePurge | null {
  const bucket = env.UPLOADS;
  if (!bucket) return null;

  return {
    async plan(projectId) {
      const prefixes = [workspacePrefix(projectId)];
      const [site] = await buildDatabase(env)
        .select({
          r2Prefix: projectSites.r2Prefix,
          subdomain: projectSites.subdomain,
          customDomain: projectSites.customDomain,
        })
        .from(projectSites)
        .where(eq(projectSites.projectId, projectId))
        .limit(1);
      if (site?.r2Prefix) prefixes.push(site.r2Prefix);

      // The host→site lookups are cached for ten minutes including the row that
      // is about to stop existing. Without this the subdomain keeps resolving to
      // a site whose assets are gone, and every request 404s from R2 instead of
      // saying the site is not there.
      if (site?.subdomain) await invalidateSite(env, site.subdomain);
      if (site?.customDomain) await invalidateCustomDomain(env, site.customDomain);
      return prefixes;
    },

    async run(prefixes) {
      for (const prefix of prefixes) await deletePrefix(bucket, prefix);
    },
  };
}
