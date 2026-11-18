/**
 * The .NET runtime bundle mirror, as pure rules (`.github/scripts/publish-dotnet-runtime.mjs` runs them).
 *
 * Each `@seanhogg/builderforce-webcontainers` release publishes its .NET runtime bundle as
 * {@link DOTNET_BUNDLE_PACKAGE} at the same version. The release workflow mirrors the version the
 * FRONTEND installed (its lockfile — what next.config.js stamps as `NEXT_PUBLIC_RUNTIME_VERSION`)
 * into the `builderforce-cdn` R2 bucket under {@link DOTNET_BUNDLE_R2_PREFIX}`<version>/`, where
 * the API serves it on the preview origin (`api/src/presentation/middleware/dotnetBundleRoute.ts`,
 * which owns content types). A version path is written once — every file, manifest LAST — and never
 * again, so its bytes never change and it can be cached `immutable`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The npm package each webcontainers release publishes the bundle as (its `DOTNET_BUNDLE.npmPackage`). */
export const DOTNET_BUNDLE_PACKAGE = '@seanhogg/builderforce-webcontainers-dotnet';

/** The browser runtime whose version the bundle must match. */
export const WEBCONTAINERS_PACKAGE = '@seanhogg/builderforce-webcontainers';

/** Where the bundle lives in the bucket (dotnetBundleRoute.ts `DOTNET_BUNDLE_R2_PREFIX`). */
export const DOTNET_BUNDLE_R2_PREFIX = 'webcontainers/dotnet/';

/** Every mirrored object: a version path never changes. */
export const DOTNET_BUNDLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The manifest format the runtime reads (webcontainers' `DOTNET_BUNDLE.format`). */
export const DOTNET_BUNDLE_FORMAT = 2;

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The exact version a pnpm lockfile resolved for `name` in its root importer, or null. */
export function lockedVersion(lockText, name = WEBCONTAINERS_PACKAGE) {
  const quoted = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const entry = new RegExp(`^ {6}'?${quoted}'?:\\r?\\n {8}specifier: [^\\r\\n]*\\r?\\n {8}version: ([^\\s(]+)`, 'm').exec(lockText);
  const version = entry?.[1];
  return version && VERSION.test(version) ? version : null;
}

/** The bucket key of a bundle file. */
export function bundleObjectKey(version, relativePath) {
  if (!VERSION.test(version)) throw new Error(`Not an exact version: ${version}`);
  return `${DOTNET_BUNDLE_R2_PREFIX}${version}/${relativePath.split('\\').join('/')}`;
}

/** Upload order: every file the manifest lists, then the manifest itself LAST (it is what says "this version is here"). */
export function uploadOrder(manifest) {
  return [...Object.keys(manifest.files ?? {}).filter((path) => path !== 'manifest.json').sort(), 'manifest.json'];
}

/** What is wrong with the unpacked bundle in `dir` (empty: nothing) — the format, and every file against its hash. */
export function bundleProblems(dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return ['manifest.json is missing'];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return ['manifest.json is not JSON'];
  }
  const problems = [];
  if (manifest.format !== DOTNET_BUNDLE_FORMAT) problems.push(`manifest format ${manifest.format}; the runtime reads ${DOTNET_BUNDLE_FORMAT}`);
  const files = Object.entries(manifest.files ?? {});
  if (files.length === 0) problems.push('the manifest lists no files');
  for (const [path, sha256] of files) {
    if (path.split(/[\\/]/).some((segment) => segment === '..' || segment === '')) { problems.push(`${path}: not a plain relative path`); continue; }
    const file = join(dir, path);
    if (!existsSync(file)) { problems.push(`${path}: missing`); continue; }
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256) problems.push(`${path}: does not match its hash`);
  }
  return problems;
}
