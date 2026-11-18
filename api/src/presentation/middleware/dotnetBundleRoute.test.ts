import { describe, expect, it, vi } from 'vitest';
import {
  DOTNET_BUNDLE_CACHE_CONTROL, dotnetBundleBucketOf, dotnetBundleContentType, dotnetBundleKeyOf, serveDotnetBundleFile, type DotnetBundleBucket,
} from './dotnetBundleRoute';

const HOST = 'https://preview.builderforce.ai';
const APP_HOST = 'https://0123456789abcdef0123456789abcdef.preview.builderforce.ai';

/** An R2 bucket holding `objects` (key → text). */
function bucket(objects: Record<string, string>) {
  const object = (key: string) => {
    const text = objects[key];
    if (text === undefined) return null;
    const bytes = new TextEncoder().encode(text);
    return { key, size: bytes.byteLength, httpEtag: `"etag-${key}"`, body: new Response(bytes).body };
  };
  return {
    get: vi.fn(async (key: string) => object(key)),
    head: vi.fn(async (key: string) => { const found = object(key); return found && { ...found, body: undefined }; }),
  } as unknown as DotnetBundleBucket & { get: ReturnType<typeof vi.fn>; head: ReturnType<typeof vi.fn> };
}

const BUNDLE = bucket({
  'webcontainers/dotnet/2026.11.5/manifest.json': '{"format":2}',
  'webcontainers/dotnet/2026.11.5/_framework/dotnet.js': 'export const dotnet = {};',
  'webcontainers/dotnet/2026.11.5/_framework/dotnet.native.wasm': 'wasm',
  'webcontainers/dotnet/2026.11.5/_framework/System.Private.CoreLib.dll': 'dll',
  'webcontainers/dotnet/2026.11.5/refs/netcore.bin': 'pack',
});

const serve = (url: string, method = 'GET', from: DotnetBundleBucket | undefined = BUNDLE) => serveDotnetBundleFile(new Request(url, { method }), from);

describe('the .NET runtime bundle on the preview origin', () => {
  it('serves a mirrored version’s files from R2 under webcontainers/dotnet/<version>/, cached for a year as immutable', async () => {
    const file = (await serve(`${HOST}/dotnet/2026.11.5/manifest.json`))!;
    expect(file.status).toBe(200);
    expect(file.cacheControl).toBe(DOTNET_BUNDLE_CACHE_CONTROL);
    expect(file.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(file.contentType).toBe('application/json; charset=utf-8');
    expect(file.contentLength).toBe(12);
    expect(file.etag).toBe('"etag-webcontainers/dotnet/2026.11.5/manifest.json"');
    expect(await new Response(file.body).text()).toBe('{"format":2}');
  });

  it('serves the same files on an app’s own preview origin', async () => {
    const file = (await serve(`${APP_HOST}/dotnet/2026.11.5/_framework/dotnet.js`))!;
    expect(file.status).toBe(200);
    expect(await new Response(file.body).text()).toBe('export const dotnet = {};');
  });

  it.each([
    ['_framework/dotnet.js', 'text/javascript; charset=utf-8'],
    ['_framework/dotnet.native.wasm', 'application/wasm'],
    ['_framework/System.Private.CoreLib.dll', 'application/octet-stream'],
    ['refs/netcore.bin', 'application/octet-stream'],
  ])('answers %s as %s (module scripts and streaming wasm need their real types)', async (path, type) => {
    const file = (await serve(`${HOST}/dotnet/2026.11.5/${path}`))!;
    expect(file.status).toBe(200);
    expect(file.contentType).toBe(type);
  });

  it('answers HEAD from the object’s metadata without reading its body', async () => {
    const before = BUNDLE.get.mock.calls.length;
    const file = (await serve(`${HOST}/dotnet/2026.11.5/refs/netcore.bin`, 'HEAD'))!;
    expect(file).toMatchObject({ status: 200, body: null, contentLength: 4, cacheControl: DOTNET_BUNDLE_CACHE_CONTROL });
    expect(BUNDLE.get.mock.calls.length).toBe(before);
  });

  it('answers a version that is not mirrored yet with an uncached 404, so dotnet declines until it lands', async () => {
    for (const file of [await serve(`${HOST}/dotnet/2026.11.6/manifest.json`), await serveDotnetBundleFile(new Request(`${HOST}/dotnet/2026.11.5/manifest.json`), undefined)]) {
      expect(file).toMatchObject({ status: 404, body: null, cacheControl: 'no-store' });
    }
  });

  it('refuses malformed paths as 404 without touching the bucket: ranges, traversal, dot-files, depth', async () => {
    const bad = [
      '/dotnet/', '/dotnet/2026.11.5', '/dotnet/2026.11.5/', '/dotnet/latest/manifest.json', '/dotnet/%5E2026.11.5/manifest.json',
      '/dotnet/2026.11.5/.env', '/dotnet/2026.11.5/a//b.js', '/dotnet/2026.11.5/a/b/c/d.js',
      '/dotnet/2026.11.5/_framework%2Fdotnet.js',
    ];
    const empty = bucket({});
    for (const path of bad) {
      expect(dotnetBundleKeyOf(path), path).toBeNull();
      expect(await serve(`${HOST}${path}`, 'GET', empty), path).toMatchObject({ status: 404 });
    }
    expect(empty.get).not.toHaveBeenCalled();
    // URL parsing resolves `..` before the route sees it; a raw path with one is refused too.
    expect(dotnetBundleKeyOf('/dotnet/2026.11.5/../../uploads/secret')).toBeNull();
  });

  it('is not its business: other paths and methods fall through (null)', async () => {
    expect(await serve(`${HOST}/__bfwc/dotnet-worker.js`)).toBeNull();
    expect(await serve(`${HOST}/dotnetfoo/2026.11.5/manifest.json`)).toBeNull();
    expect(await serve(`${HOST}/dotnet/2026.11.5/manifest.json`, 'POST')).toBeNull();
  });

  it('maps a path to its key, accepts prerelease versions, and reads the CDN binding', () => {
    expect(dotnetBundleKeyOf('/dotnet/2026.11.5-rc.1/_framework/dotnet.js')).toBe('webcontainers/dotnet/2026.11.5-rc.1/_framework/dotnet.js');
    expect(dotnetBundleContentType('webcontainers/dotnet/1.0.0/_framework/dotnet.js.map')).toBe('application/json; charset=utf-8');
    expect(dotnetBundleContentType('webcontainers/dotnet/1.0.0/refs/noext')).toBe('application/octet-stream');
    expect(dotnetBundleBucketOf({ CDN: BUNDLE })).toBe(BUNDLE);
    expect(dotnetBundleBucketOf({})).toBeUndefined();
  });
});
