import { describe, it, expect, vi } from 'vitest';
import {
  ALLOWED_ASSET_TYPES,
  assetKey,
  assetMaxBytes,
  isAllowedAsset,
  readAssetByKey,
  readTenantAsset,
  storeTenantAsset,
} from './tenantAssetStore';

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size, stream: () => new ReadableStream() } as unknown as File;
}

function fakeBucket(objects: Record<string, { body: string; type?: string }> = {}) {
  const put = vi.fn(async (key: string, _stream: unknown, opts: { httpMetadata?: { contentType?: string } }) => {
    objects[key] = { body: 'stored', type: opts.httpMetadata?.contentType };
  });
  const get = vi.fn(async (key: string) => {
    const object = objects[key];
    if (!object) return null;
    return { body: object.body, httpMetadata: { contentType: object.type } };
  });
  return { put, get, objects } as unknown as R2Bucket & { objects: typeof objects };
}

describe('assetKey', () => {
  it('is tenant-and-user prefixed and keeps the extension', () => {
    const key = assetKey(7, 'u1', 'photo.PNG');
    expect(key).toMatch(/^7\/u1\/\d+-[0-9a-f]{8}\.png$/);
  });

  // A dot-free name (e.g. "noext") is not "no extension": split('.').pop() returns
  // the whole name, matching the brainRoutes behaviour this was extracted from.
  // Only a genuinely empty name has nothing to pop.
  it('falls back to .bin for a name with no extension at all', () => {
    expect(assetKey(7, 'u1', '')).toMatch(/\.bin$/);
  });
});

describe('assetMaxBytes / isAllowedAsset', () => {
  it('gives video a larger ceiling than everything else', () => {
    expect(assetMaxBytes('video/mp4')).toBeGreaterThan(assetMaxBytes('image/png'));
  });

  it('allows every declared MIME type', () => {
    for (const type of ALLOWED_ASSET_TYPES) expect(isAllowedAsset(type, 'file')).toBe(true);
  });

  it('allows an office document by extension when the browser sends octet-stream', () => {
    expect(isAllowedAsset('application/octet-stream', 'deck.pptx')).toBe(true);
  });

  it('refuses an unlisted type', () => {
    expect(isAllowedAsset('application/x-msdownload', 'a.exe')).toBe(false);
  });
});

describe('storeTenantAsset', () => {
  const actor = { tenantId: 7, userId: 'u1' };

  it('rejects when the bucket is unconfigured', async () => {
    expect(await storeTenantAsset(undefined, fakeFile('a.png', 'image/png', 10), actor))
      .toEqual({ error: 'unconfigured' });
  });

  it('rejects a missing file', async () => {
    expect(await storeTenantAsset(fakeBucket(), null, actor)).toEqual({ error: 'no-file' });
  });

  it('rejects an oversized image but allows the same size for video', async () => {
    const big = 20 * 1024 * 1024;
    const image = await storeTenantAsset(fakeBucket(), fakeFile('a.png', 'image/png', big), actor);
    expect(image).toMatchObject({ error: 'too-large' });
    const video = await storeTenantAsset(fakeBucket(), fakeFile('a.mp4', 'video/mp4', big), actor);
    expect(video).not.toMatchObject({ error: 'too-large' });
  });

  it('rejects a disallowed type', async () => {
    expect(await storeTenantAsset(fakeBucket(), fakeFile('a.exe', 'application/x-msdownload', 10), actor))
      .toEqual({ error: 'type-not-allowed', type: 'application/x-msdownload' });
  });

  it('stores an allowed file under a tenant-prefixed key', async () => {
    const bucket = fakeBucket();
    const stored = await storeTenantAsset(bucket, fakeFile('a.png', 'image/png', 10), actor);
    expect(stored).toMatchObject({ name: 'a.png', type: 'image/png', size: 10 });
    expect((stored as { key: string }).key.startsWith('7/u1/')).toBe(true);
    expect(bucket.put).toHaveBeenCalledOnce();
  });
});

describe('readTenantAsset — tenant-checked, backs the legacy authed path', () => {
  it('refuses a key belonging to a different tenant', async () => {
    const bucket = fakeBucket({ '8/u1/x.png': { body: 'data', type: 'image/png' } });
    expect(await readTenantAsset(bucket, '8/u1/x.png', 7)).toBe('not-found');
  });

  it('serves a key owned by the caller tenant', async () => {
    const bucket = fakeBucket({ '7/u1/x.png': { body: 'data', type: 'image/png' } });
    const result = await readTenantAsset(bucket, '7/u1/x.png', 7);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get('Content-Type')).toBe('image/png');
  });
});

describe('readAssetByKey — public, the key IS the capability', () => {
  it('serves ANY existing key with no tenant check — this is what makes an embedded document link durable', async () => {
    const bucket = fakeBucket({ '8/other-user/x.png': { body: 'data', type: 'image/png' } });
    const result = await readAssetByKey(bucket, '8/other-user/x.png');
    expect(result).toBeInstanceOf(Response);
  });

  it('404s a key that does not exist, rather than leaking bucket contents', async () => {
    expect(await readAssetByKey(fakeBucket(), '7/u1/missing.png')).toBe('not-found');
  });

  it('caches aggressively — the key is unguessable and the object never changes', async () => {
    const bucket = fakeBucket({ '7/u1/x.png': { body: 'data', type: 'image/png' } });
    const result = await readAssetByKey(bucket, '7/u1/x.png') as Response;
    expect(result.headers.get('Cache-Control')).toContain('immutable');
  });
});
