/**
 * A PREVIEW release of a published site (PRD 33 §5.1.4, D13 "nothing reaches
 * production on its own").
 *
 * `publishStaticSite` always moves the live pointer. A fix an agent builds from an
 * Insights prescription must not: it lands as a release in the SAME register
 * (`site_releases`, under its own version prefix) while `project_sites` keeps
 * pointing at the live build. Making it live is then the existing pointer move
 * (`restoreSiteRelease`) a person triggers from Insights — and the A/B split
 * (`siteAbSplit.ts`) can serve it to a share of visitors before that.
 *
 * Needs a site that is already published (a preview of nothing has no live to
 * compare against). The landing document is carried over from the live release so
 * the preview is a complete site. Old releases age out through the ordinary prune.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { appsDatabaseOf } from './appsDatabase';
import { contentTypeFor, HOSTING_APEX, newVersionToken, SITES_PREFIX } from './siteHosting';
import { SITE_LANDING_KEY } from './siteLandingPage';
import { recordSiteRelease, type ReleaseSource } from './siteReleases';
import type { PublishAsset } from './publishStaticSite';

export type PreviewPublishResult =
  | { ok: true; versionToken: string; liveVersionToken: string; assetCount: number; totalBytes: number; url: string }
  | { ok: false; status: 400 | 409; error: string };

export async function publishPreviewRelease(input: {
  db: Db;
  bucket: R2Bucket;
  projectId: number;
  tenantId: number;
  source?: ReleaseSource;
  assets: PublishAsset[];
}): Promise<PreviewPublishResult> {
  const { db, bucket, projectId, tenantId, assets } = input;
  if (assets.length === 0) return { ok: false, status: 400, error: 'No assets uploaded. Build the project first.' };

  const [site] = await appsDatabaseOf(db)
    .select({ id: projectSites.id, subdomain: projectSites.subdomain, r2Prefix: projectSites.r2Prefix, versionToken: projectSites.versionToken })
    .from(projectSites)
    .where(scopedToTenant(projectSites, tenantId, eq(projectSites.projectId, projectId)))
    .limit(1);
  if (!site) return { ok: false, status: 409, error: 'Publish the site live once before publishing a preview.' };

  const versionToken = newVersionToken();
  const prefix = `${SITES_PREFIX}${site.subdomain}/${versionToken}/`;
  let totalBytes = 0;
  for (const asset of assets) {
    if (asset.path === SITE_LANDING_KEY) continue;
    totalBytes += asset.size;
    await bucket.put(prefix + asset.path, asset.body, { httpMetadata: { contentType: contentTypeFor(asset.path) } });
  }
  try {
    const landing = await bucket.get(site.r2Prefix + SITE_LANDING_KEY);
    if (landing) {
      const html = await landing.text();
      totalBytes += html.length;
      await bucket.put(prefix + SITE_LANDING_KEY, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    }
  } catch (error) {
    // A preview without the shop window still previews the app.
    reportCaughtError(error, { source: 'application/ide/publishPreviewRelease.ts', operation: 'copyLanding' });
  }

  await recordSiteRelease({
    db, bucket, siteId: site.id, tenantId, subdomain: site.subdomain,
    versionToken, r2Prefix: prefix, source: input.source ?? 'browser',
    assetCount: assets.length, totalBytes,
  });
  return {
    ok: true,
    versionToken,
    liveVersionToken: site.versionToken,
    assetCount: assets.length,
    totalBytes,
    url: `https://${site.subdomain}.${HOSTING_APEX}`,
  };
}
