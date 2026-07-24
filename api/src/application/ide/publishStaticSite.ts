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

import type { Env } from '../../env';
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
  /** Neon tagged-template client, supplied by the caller's router. */
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
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
  const { env, sql, bucket, projectId, tenantId, projectName, requestedSubdomain, assets } = input;

  if (assets.length === 0) {
    return { ok: false, status: 400, error: 'No assets uploaded. Build the project first.' };
  }

  const [current] = await sql`
    SELECT subdomain FROM project_sites WHERE project_id = ${projectId} LIMIT 1`;
  const oldSub = current?.subdomain as string | undefined;

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
  const [owner] = await sql`
    SELECT project_id FROM project_sites WHERE subdomain = ${subdomain} LIMIT 1`;
  if (owner && Number(owner.project_id) !== projectId) {
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
  await sql`
    INSERT INTO project_sites
      (project_id, tenant_id, subdomain, mode, status, r2_prefix, version_token, asset_count, total_bytes, published_at)
    VALUES
      (${projectId}, ${tenantId}, ${subdomain}, 'static', 'active', ${newPrefix}, ${versionToken}, ${assets.length}, ${totalBytes}, NOW())
    ON CONFLICT (project_id) DO UPDATE SET
      subdomain = EXCLUDED.subdomain,
      r2_prefix = EXCLUDED.r2_prefix,
      version_token = EXCLUDED.version_token,
      status = 'active',
      asset_count = EXCLUDED.asset_count,
      total_bytes = EXCLUDED.total_bytes,
      published_at = NOW(),
      updated_at = NOW()`;
  await invalidateSite(env, subdomain);

  const url = `https://${subdomain}.${HOSTING_APEX}`;

  // Wire deploy → test: a published site is a testable target. Keep the project's
  // default QA target pointed at the live URL (create it the first time, refresh
  // it on every republish) so the Agentic Tester can run against a just-deployed
  // app with no manual "add a target" step. Best-effort — a failure here must
  // never fail the publish itself.
  try {
    await sql`
      UPDATE qa_targets SET base_url = ${url}, status = 'active', updated_at = NOW()
      WHERE project_id = ${projectId} AND is_default = true`;
    await sql`
      INSERT INTO qa_targets (tenant_id, project_id, name, base_url, is_default, status)
      SELECT ${tenantId}, ${projectId}, 'Production', ${url}, true, 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM qa_targets WHERE project_id = ${projectId} AND is_default = true)`;
  } catch {
    /* target auto-provisioning is best-effort; publish still succeeded */
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
