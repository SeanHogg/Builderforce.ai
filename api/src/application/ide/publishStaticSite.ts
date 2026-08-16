import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Static-site publish core — the ONE implementation of "put a built app live at
 * a subdomain", shared by both publish paths.
 *
 * There are two producers of a build and they must land identically:
 *   - the browser: the IDE builds in the WebContainer and POSTs `dist/` to
 *     `/api/ide/projects/:id/publish` (tenant-JWT authenticated);
 *   - GitHub Actions: a workflow in the user's own repo builds on a runner and
 *     POSTs `dist/` to `/api/deploy/github` (OIDC authenticated).
 *
 * Both end at this function, so subdomain claiming, stale-asset cleanup, the
 * `project_sites` upsert and cache invalidation cannot drift between them. A
 * project can therefore switch between publishing from the browser and from CI
 * with no change in the resulting site.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites, qaTargets } from '../../infrastructure/database/schema';
import {
  SITES_PREFIX,
  HOSTING_APEX,
  checkSubdomainAvailability,
  newVersionToken,
  invalidateSite,
  contentTypeFor,
} from './siteHosting';
import { ensureDefaultCollection } from './siteData';
import { ensureProjectBackend } from '../backend';
import { recordSiteRelease, type ReleaseSource } from './siteReleases';
import { SITE_LANDING_KEY, landingPageForProject } from './siteLandingPage';

/** A single built file, dist-relative. */
export interface PublishAsset {
  /** Path under the site root, e.g. `assets/app.4f3a.js`. */
  path: string;
  body: ReadableStream | ArrayBuffer | string;
  size: number;
}

export interface PublishInput {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  projectId: number;
  tenantId: number;
  /** Fallback for the subdomain when none is requested and none exists yet. */
  projectName: string;
  /** Explicit subdomain; falls back to the current site's, then the project name. */
  requestedSubdomain?: string | null;
  /**
   * Which producer built this. Recorded on the release so a reader can tell a
   * browser publish from a CI one when choosing what to roll back to. Defaults to
   * `browser`, the older of the two paths.
   */
  source?: ReleaseSource;
  assets: PublishAsset[];
}

export interface PublishSuccess {
  ok: true;
  subdomain: string;
  versionToken: string;
  assetCount: number;
  totalBytes: number;
  url: string;
  pathUrl: string;
}

export interface PublishFailure {
  ok: false;
  status: 400 | 409;
  error: string;
}

export type PublishResult = PublishSuccess | PublishFailure;

/**
 * Claim the subdomain, replace its contents with `assets`, and record the
 * release. Returns a typed failure (rather than throwing) for the two cases a
 * caller must surface to the user: an unusable subdomain and one already owned
 * by a different project.
 */
export async function publishStaticSite(input: PublishInput): Promise<PublishResult> {
  const { env, db, bucket, projectId, tenantId, projectName, requestedSubdomain, assets } = input;

  if (assets.length === 0) {
    return { ok: false, status: 400, error: 'No assets uploaded. Build the project first.' };
  }

  const [current] = await db
    .select({ subdomain: projectSites.subdomain, landingObjectId: projectSites.landingObjectId })
    .from(projectSites)
    .where(eq(projectSites.projectId, projectId))
    .limit(1);
  const oldSub = current?.subdomain;

  const requested = requestedSubdomain?.trim() || oldSub || projectName || `app-${projectId}`;
  // ONE uniqueness rule, shared with the availability endpoint and the
  // conversion path (`checkSubdomainAvailability`). This used to normalise and
  // check ownership inline; three copies of that rule is how one of them starts
  // accepting a reserved label that the serving side then refuses to route.
  const availability = await checkSubdomainAvailability(db, requested, projectId);
  if (!availability.label) {
    return {
      ok: false,
      status: 400,
      error: availability.reason === 'reserved'
        ? `"${requested}" is reserved by the platform. Choose another address.`
        : 'Invalid subdomain. Use lowercase letters, numbers and hyphens.',
    };
  }
  if (!availability.available) {
    return { ok: false, status: 409, error: `Subdomain "${availability.label}" is taken.` };
  }
  const subdomain = availability.label;

  // Each build lands under its OWN version prefix rather than overwriting the
  // subdomain root. Publishing used to delete every object under the subdomain
  // before writing, so a bad release destroyed the working one it replaced and
  // there was nothing to go back to — which an autonomous agent guarantees you
  // will eventually need. Old versions are pruned below, not here.
  const versionToken = newVersionToken();
  const newPrefix = `${SITES_PREFIX}${subdomain}/${versionToken}/`;

  // If this project previously published under a DIFFERENT subdomain, retire it —
  // the name is now free for someone else, so nothing of ours may remain there.
  if (oldSub && oldSub !== subdomain) {
    const oldPrefix = `${SITES_PREFIX}${oldSub}/`;
    for (const obj of (await bucket.list({ prefix: oldPrefix })).objects ?? []) {
      await bucket.delete(obj.key!);
    }
    await invalidateSite(env, oldSub);
  }

  let totalBytes = 0;
  for (const asset of assets) {
    // The landing document's key is reserved. A build that happens to emit a file at
    // this exact path would otherwise overwrite the creator's shop window with one of
    // its own artefacts — and silently, since both are HTML at the same key.
    if (asset.path === SITE_LANDING_KEY) continue;
    totalBytes += asset.size;
    await bucket.put(newPrefix + asset.path, asset.body, {
      httpMetadata: { contentType: contentTypeFor(asset.path) },
    });
  }

  // ── The second source ────────────────────────────────────────────────────────
  // The landing page is rendered and written HERE, into the same version prefix, in
  // the same publish. Publishing it separately is what the single-prefix hazard
  // actually is: two producers each replacing the site's contents, so a deploy
  // silently drops the brand page or a page republish 404s the app. Written together,
  // a release is one atomic pair and a rollback restores both.
  //
  // Best-effort by design: an app that builds must never fail to ship because its
  // shop window could not be rendered. A failure here leaves the previous release's
  // landing page behind — which is stale, and still better than an unpublishable app.
  let landingObjectId: string | null = null;
  try {
    const landing = await landingPageForProject(db, projectId, {
      brand: projectName || subdomain,
      preferObjectId: current?.landingObjectId ?? null,
    });
    if (landing) {
      landingObjectId = landing.objectId;
      totalBytes += landing.html.length;
      await bucket.put(newPrefix + SITE_LANDING_KEY, landing.html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      });
    }
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/ide/publishStaticSite.ts',
      operation: 'renderLandingPage',
    });
  }

  const [siteRow] = await db
    .insert(projectSites)
    .values({
      projectId,
      tenantId,
      subdomain,
      mode: 'static',
      status: 'active',
      r2Prefix: newPrefix,
      versionToken,
      assetCount: assets.length,
      totalBytes,
      landingObjectId,
      publishedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: projectSites.projectId,
      set: {
        subdomain,
        r2Prefix: newPrefix,
        versionToken,
        status: 'active',
        assetCount: assets.length,
        totalBytes,
        // Written on every publish, including as null: a creator who deletes their
        // `website` card has withdrawn the shop window, and a stale pointer would go
        // on serving a landing page whose source no longer exists.
        landingObjectId,
        publishedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning({ id: projectSites.id });
  await invalidateSite(env, subdomain);

  // Register the release and prune old ones. Best-effort for the same reason the
  // convenience rows below are: a publish that succeeded must not be reported as
  // failed because its history entry could not be written. The site is already
  // live and pointing at the new prefix by this line.
  if (siteRow?.id) {
    try {
      await recordSiteRelease({
        db, bucket, siteId: siteRow.id, tenantId, subdomain,
        versionToken, r2Prefix: newPrefix, source: input.source ?? 'browser',
        assetCount: assets.length, totalBytes,
      });
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/ide/publishStaticSite.ts',
        operation: 'recordSiteRelease',
      });
    }
  }

  const url = `https://${subdomain}.${HOSTING_APEX}`;

  // Give the new site a working backend with zero setup: a `signups` collection
  // means a form on the page someone just published already has somewhere to
  // post. Same best-effort posture as the QA target below — a published site
  // must never fail to publish because a convenience row could not be written.
  if (siteRow?.id) {
    try {
      await ensureDefaultCollection(db, tenantId, siteRow.id, projectId);
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/ide/publishStaticSite.ts',
        operation: 'ensureDefaultCollection',
      });
    }
  }

  // …and a backend row, which is what makes the project's canvas handlers answer
  // at `https://<site>/api/<route>`. Without it a handler someone wrote in the
  // IDE would only ever be reachable at the opaque `/hooks/<token>` address —
  // the site's own pages could not call it. Best-effort for the same reason.
  try {
    await ensureProjectBackend(env, db, tenantId, projectId);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/ide/publishStaticSite.ts',
      operation: 'ensureProjectBackend',
    });
  }

  // Wire deploy → test: a published site is a testable target. Keep the project's
  // default QA target pointed at the live URL (create it the first time, refresh
  // it on every republish) so the Agentic Tester can run against a just-deployed
  // app with no manual "add a target" step. Best-effort — a failure here must
  // never fail the publish itself.
  try {
    await db
      .update(qaTargets)
      .set({ baseUrl: url, status: 'active', updatedAt: sql`NOW()` })
      .where(and(eq(qaTargets.projectId, projectId), eq(qaTargets.isDefault, true)));
    // INSERT ... SELECT ... WHERE NOT EXISTS stays raw: it creates the default
    // target only if none exists, in ONE statement. Splitting it into a read then
    // an insert would open a race that could produce two defaults for a project.
    await db.execute(sql`
      INSERT INTO ${qaTargets} (tenant_id, project_id, name, base_url, is_default, status)
      SELECT ${tenantId}, ${projectId}, 'Production', ${url}, true, 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM ${qaTargets}
        WHERE ${qaTargets.projectId} = ${projectId} AND ${qaTargets.isDefault} = true)`);
  } catch (error) {
    /* target auto-provisioning is best-effort; publish still succeeded */
  
    reportCaughtError(error, { source: "application/ide/publishStaticSite.ts", operation: "publishStaticSite" });
  }

  return {
    ok: true,
    subdomain,
    versionToken,
    assetCount: assets.length,
    totalBytes,
    url,
    pathUrl: `/api/sites/${subdomain}/`,
  };
}

/**
 * Normalize a multipart form into publish assets: every file part, keyed by its
 * dist-relative part NAME. Shared so both producers agree on path handling
 * (leading slashes and a `dist/` prefix are stripped).
 */
export function assetsFromFormData(form: FormData, skipFields: string[] = []): PublishAsset[] {
  const skip = new Set(skipFields);
  const assets: PublishAsset[] = [];
  for (const [name, value] of form.entries()) {
    if (skip.has(name) || typeof value === 'string') continue;
    const file = value as unknown as File;
    const path = name.replace(/^\/+/, '').replace(/^dist\//, '');
    if (path) assets.push({ path, body: file.stream(), size: file.size });
  }
  return assets;
}
