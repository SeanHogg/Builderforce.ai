/**
 * The .NET runtime bundle on the preview origin: `/dotnet/<version>/<file>`.
 *
 * A .NET process (`dotnet run`) runs in a Worker on the preview origin
 * (`preview.builderforce.ai`, or an app's `<key>-preview.builderforce.ai`), and
 * that Worker loads scripts only from its own origin — so the ~73 MiB Mono
 * browser-wasm bundle (manifest, `_framework/`, `refs/`) is served HERE, same
 * origin, and the frontend passes `<preview origin>/dotnet/<version>/` as
 * `dotnet.bundleUrl` (`frontend/src/lib/browserRuntime/previewDotnetOptions.ts`).
 *
 * Where the bytes come from: each `@seanhogg/builderforce-webcontainers` release
 * publishes the bundle as `@seanhogg/builderforce-webcontainers-dotnet` at the same
 * version; the release workflow (`.github/scripts/publish-dotnet-runtime.mjs`)
 * mirrors the version the frontend has installed into the `CDN` R2 bucket under
 * {@link DOTNET_BUNDLE_R2_PREFIX}`<version>/`, manifest last, never over an
 * existing version. A version path's bytes therefore never change: every hit is
 * cached for a year, `immutable`. Integrity stays with the runtime — its loader
 * checks every file against the manifest's SHA-256 before using it.
 *
 * A version not mirrored (yet) answers 404 with `no-store`, so the runtime's
 * `dotnet` commands decline with "the manifest could not be loaded (HTTP 404)"
 * and the next request after the mirror lands succeeds.
 *
 * Headers are NOT set here: the preview host's ONE header builder wraps every
 * response it serves (CSP, COEP/CORP, nosniff). This module answers what the body
 * is, its type and how long it may be cached.
 */

/** Where the bundle lives on the preview origin. */
export const DOTNET_BUNDLE_PATH_PREFIX = '/dotnet/';

/** Where the mirrored bundle lives in the `CDN` bucket (the publish script writes the same prefix). */
export const DOTNET_BUNDLE_R2_PREFIX = 'webcontainers/dotnet/';

/** A version path never changes (the mirror never overwrites one). */
export const DOTNET_BUNDLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** A missing version may be mirrored any moment: never cache its 404. */
const MISSING_CACHE_CONTROL = 'no-store';

/** An exact package version (`2026.11.5`, `2026.11.5-rc.1`): never a range or a tag. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** One path segment of a bundle file: no dot-files, so never `.` or `..`. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** The bundle's deepest file is `_framework/<file>` or `refs/<file>`. */
const MAX_DEPTH = 3;

/** The content type of a bundle file, by extension — module scripts must be JavaScript, wasm `application/wasm` (streaming compile). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
};
const BINARY = 'application/octet-stream';

/** The slice of an R2 bucket this route reads. */
export type DotnetBundleBucket = Pick<R2Bucket, 'get' | 'head'>;

/** What a bundle request answers; the caller's header builder turns it into a Response. */
export interface DotnetBundleFile {
  status: 200 | 404;
  /** Null for HEAD and for a 404. */
  body: ReadableStream | null;
  contentType: string;
  cacheControl: string;
  /** The object's size (200 only). */
  contentLength?: number;
  /** The object's HTTP ETag (200 only). */
  etag?: string;
}

/** The bucket the bundle is mirrored into: the API's `CDN` binding (`api/wrangler.toml`). */
export function dotnetBundleBucketOf(env: { CDN?: DotnetBundleBucket }): DotnetBundleBucket | undefined {
  return env.CDN;
}

/** The R2 key a bundle path names, or null when the path is not a well-formed `/dotnet/<version>/<file>`. */
export function dotnetBundleKeyOf(pathname: string): string | null {
  if (!pathname.startsWith(DOTNET_BUNDLE_PATH_PREFIX)) return null;
  const [version, ...file] = pathname.slice(DOTNET_BUNDLE_PATH_PREFIX.length).split('/');
  if (!version || !VERSION.test(version)) return null;
  if (file.length === 0 || file.length > MAX_DEPTH || !file.every((segment) => SEGMENT.test(segment))) return null;
  return `${DOTNET_BUNDLE_R2_PREFIX}${version}/${file.join('/')}`;
}

/** A bundle file's content type, by extension. */
export function dotnetBundleContentType(key: string): string {
  const dot = key.lastIndexOf('.');
  return (dot > key.lastIndexOf('/') && CONTENT_TYPES[key.slice(dot + 1).toLowerCase()]) || BINARY;
}

const missing = (): DotnetBundleFile => ({ status: 404, body: null, contentType: 'text/plain; charset=utf-8', cacheControl: MISSING_CACHE_CONTROL });

/**
 * Answer a `/dotnet/…` request from `bucket`. Null when the request is not one —
 * another path, or a method other than GET/HEAD — so the caller's chain goes on.
 * A malformed bundle path, a missing object or a missing binding is a 404.
 */
export async function serveDotnetBundleFile(request: Request, bucket: DotnetBundleBucket | undefined): Promise<DotnetBundleFile | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(DOTNET_BUNDLE_PATH_PREFIX)) return null;
  const key = dotnetBundleKeyOf(pathname);
  if (!key || !bucket) return missing();
  const object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key);
  if (!object) return missing();
  return {
    status: 200,
    body: request.method === 'HEAD' ? null : (object as R2ObjectBody).body,
    contentType: dotnetBundleContentType(key),
    cacheControl: DOTNET_BUNDLE_CACHE_CONTROL,
    contentLength: object.size,
    etag: object.httpEtag,
  };
}
