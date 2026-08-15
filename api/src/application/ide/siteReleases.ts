/**
 * Site releases — the register that makes a published site revertible.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * `publishStaticSite` deleted every object under the subdomain prefix before
 * writing the new build. The previous release was therefore gone the instant a
 * worse one shipped, and the `versionToken` it recorded was a cache-busting
 * token, not something restorable. Every competing prompt-to-app product treats
 * one-click revert as mandatory, for the plainest reason: an agent that writes
 * code will eventually write code that breaks a working app, and the value of
 * autonomy depends entirely on being able to be wrong cheaply.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 * A build lands at `sites/<sub>/<versionToken>/`, a `site_releases` row records
 * it, and `project_sites.r2_prefix` POINTS at whichever version is current.
 * Restoring is therefore a pointer move plus a cache invalidation — no copying,
 * no rebuild, and no window where the site serves half of two releases.
 *
 * The pointer on `project_sites` is a deliberate denormalisation: serving one
 * asset must resolve a site in a single read, and a join per request would put
 * this table on the hot path. There is exactly one writer (this module and the
 * publish it is called from), which is the condition that makes it safe.
 */

import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites, siteReleases } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateSite } from './siteHosting';

/**
 * Releases kept per site. Older ones have their assets deleted and their row
 * removed, so storage is bounded by builds-per-site rather than by time.
 *
 * Ten is chosen against the failure it exists for: "the last good one" is almost
 * always within a handful of publishes, and a tenant iterating with an agent can
 * publish several times in an hour. Keeping fewer would put the working version
 * out of reach on exactly the day it is needed.
 */
export const MAX_RELEASES_PER_SITE = 10;

/** Where a build came from. Both producers land in the same register. */
export type ReleaseSource = 'browser' | 'github';

export interface ReleaseView {
  versionToken: string;
  source: string;
  assetCount: number;
  totalBytes: number;
  publishedAt: string | null;
  /** True for the release the site is serving right now. */
  current: boolean;
}

/** Record a freshly-published build and prune the oldest beyond the cap. */
export async function recordSiteRelease(input: {
  db: Db;
  bucket: R2Bucket;
  siteId: number;
  tenantId: number;
  subdomain: string;
  versionToken: string;
  r2Prefix: string;
  source: ReleaseSource;
  assetCount: number;
  totalBytes: number;
}): Promise<void> {
  const { db, bucket, siteId, tenantId, versionToken, r2Prefix, source, assetCount, totalBytes } = input;
  await db
    .insert(siteReleases)
    .values({ siteId, tenantId, versionToken, r2Prefix, source, assetCount, totalBytes, publishedAt: sql`NOW()` })
    .onConflictDoNothing();

  const all = await db
    .select({ id: siteReleases.id, r2Prefix: siteReleases.r2Prefix })
    .from(siteReleases)
    .where(scopedToTenant(siteReleases, tenantId, eq(siteReleases.siteId, siteId)))
    .orderBy(desc(siteReleases.publishedAt));
  for (const stale of all.slice(MAX_RELEASES_PER_SITE)) {
    for (const object of (await bucket.list({ prefix: stale.r2Prefix })).objects ?? []) {
      await bucket.delete(object.key!);
    }
    await db.delete(siteReleases).where(scopedToTenant(siteReleases, tenantId, eq(siteReleases.id, stale.id)));
  }
}

/** Every release of this project's site, newest first. */
export async function listSiteReleases(db: Db, projectId: number, tenantId: number): Promise<ReleaseView[]> {
  const [site] = await db
    .select({ id: projectSites.id, current: projectSites.versionToken })
    .from(projectSites)
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.projectId, projectId)))
    .limit(1);
  if (!site) return [];
  const rows = await db
    .select({
      versionToken: siteReleases.versionToken,
      source: siteReleases.source,
      assetCount: siteReleases.assetCount,
      totalBytes: siteReleases.totalBytes,
      publishedAt: siteReleases.publishedAt,
    })
    .from(siteReleases)
    .where(scopedToTenant(siteReleases, tenantId, eq(siteReleases.siteId, site.id)))
    .orderBy(desc(siteReleases.publishedAt));
  return rows.map((row) => ({
    versionToken: row.versionToken,
    source: row.source,
    assetCount: row.assetCount,
    totalBytes: Number(row.totalBytes ?? 0),
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    current: row.versionToken === site.current,
  }));
}

export type RestoreResult =
  | { ok: true; versionToken: string; url: string }
  | { ok: false; status: 404; error: string };

/**
 * Point the site at an earlier release.
 *
 * Deliberately does NOT delete the release it moved away from: the version that
 * was current a moment ago is the one a user is most likely to want back if the
 * revert was itself a mistake, and a rollback that burns its own bridge is a
 * worse safety net than none. It ages out through the ordinary prune like any
 * other release.
 */
export async function restoreSiteRelease(
  env: Env,
  db: Db,
  projectId: number,
  tenantId: number,
  versionToken: string,
  hostingApex: string,
): Promise<RestoreResult> {
  const [site] = await db
    .select({ id: projectSites.id, subdomain: projectSites.subdomain })
    .from(projectSites)
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.projectId, projectId)))
    .limit(1);
  if (!site) return { ok: false, status: 404, error: 'This project has no published site.' };

  const [release] = await db
    .select({ r2Prefix: siteReleases.r2Prefix, assetCount: siteReleases.assetCount, totalBytes: siteReleases.totalBytes })
    .from(siteReleases)
    .where(scopedToTenant(siteReleases, tenantId, eq(siteReleases.siteId, site.id), eq(siteReleases.versionToken, versionToken)))
    .limit(1);
  if (!release) return { ok: false, status: 404, error: 'That version is no longer available.' };

  await db
    .update(projectSites)
    .set({
      r2Prefix: release.r2Prefix,
      versionToken,
      assetCount: release.assetCount,
      totalBytes: release.totalBytes,
      status: 'active',
      updatedAt: sql`NOW()`,
    })
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.id, site.id)));
  await invalidateSite(env, site.subdomain);

  return { ok: true, versionToken, url: `https://${site.subdomain}.${hostingApex}` };
}
