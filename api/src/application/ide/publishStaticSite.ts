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
  normalizeSubdomain,
  newVersionToken,
  invalidateSite,
  contentTypeFor,
} from './siteHosting';

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
    .select({ subdomain: projectSites.subdomain })
    .from(projectSites)
    .where(eq(projectSites.projectId, projectId))
    .limit(1);
  const oldSub = current?.subdomain;

  const requested = requestedSubdomain?.trim() || oldSub || projectName || `app-${projectId}`;
  const subdomain = normalizeSubdomain(requested);
  if (!subdomain) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid or reserved subdomain. Use lowercase letters, numbers and hyphens.',
    };
  }

  // Global uniqueness — a subdomain can't be claimed by another project.
  const [owner] = await db
    .select({ projectId: projectSites.projectId })
    .from(projectSites)
    .where(eq(projectSites.subdomain, subdomain))
    .limit(1);
  if (owner && Number(owner.projectId) !== projectId) {
    return { ok: false, status: 409, error: `Subdomain "${subdomain}" is taken.` };
  }

  const newPrefix = `${SITES_PREFIX}${subdomain}/`;
  // Clear prior contents under this subdomain (stale files from an earlier build,
  // or a different project that just released the name) before writing.
  for (const obj of (await bucket.list({ prefix: newPrefix })).objects ?? []) {
    await bucket.delete(obj.key!);
  }
  // If this project previously published under a DIFFERENT subdomain, retire it.
  if (oldSub && oldSub !== subdomain) {
    const oldPrefix = `${SITES_PREFIX}${oldSub}/`;
    for (const obj of (await bucket.list({ prefix: oldPrefix })).objects ?? []) {
      await bucket.delete(obj.key!);
    }
    await invalidateSite(env, oldSub);
  }

  let totalBytes = 0;
  for (const asset of assets) {
    totalBytes += asset.size;
    await bucket.put(newPrefix + asset.path, asset.body, {
      httpMetadata: { contentType: contentTypeFor(asset.path) },
    });
  }

  const versionToken = newVersionToken();
  await db
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
        publishedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      },
    });
  await invalidateSite(env, subdomain);

  const url = `https://${subdomain}.${HOSTING_APEX}`;

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
