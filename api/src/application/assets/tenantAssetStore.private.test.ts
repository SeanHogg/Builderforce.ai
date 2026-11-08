import { describe, expect, it, vi } from 'vitest';
import {
  deletePrivateObject, isPrivateAssetKey, readAssetByKey, readPrivateObject, readTenantAsset, signTenantAsset, storePrivateObject,
  storeTenantAsset,
} from './tenantAssetStore';

/** An in-memory R2 stand-in. */
function bucket() {
  const store = new Map<string, string>();
  const b = {
    put: vi.fn(async (key: string, body: string) => { store.set(key, body); }),
    get: vi.fn(async (key: string) => (store.has(key) ? { body: store.get(key), httpMetadata: { contentType: 'application/json' } } : null)),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  return { b: b as unknown as R2Bucket, store, spy: b };
}

describe('private objects (DSR exports) are not assets', () => {
  it('are stored under <tenant>/private/<kind>/ and recognised as private', async () => {
    const { b } = bucket();
    const key = await storePrivateObject(b, 7, 'dsr', 'dsr-1.json', '{"a":1}', 'application/json');
    expect(key).toMatch(/^7\/private\/dsr\/[0-9a-f-]{36}\.json$/);
    expect(isPrivateAssetKey(key)).toBe(true);
    expect(isPrivateAssetKey('7/user-1/123-abcd.png')).toBe(false);
  });

  it('are NOT served by the public key-is-the-capability reader behind GET /api/assets/*', async () => {
    const { b } = bucket();
    const key = (await storePrivateObject(b, 7, 'dsr', 'x.json', '{}', 'application/json'))!;
    expect(await readAssetByKey(b, key)).toBe('not-found');
  });

  it('are NOT served by the tenant-checked upload reader, even to the owning tenant', async () => {
    const { b } = bucket();
    const key = (await storePrivateObject(b, 7, 'dsr', 'x.json', '{}', 'application/json'))!;
    expect(await readTenantAsset(b, key, 7)).toBe('not-found');
  });

  it('cannot be turned into a signed public link', async () => {
    const { b } = bucket();
    const key = (await storePrivateObject(b, 7, 'dsr', 'x.json', '{}', 'application/json'))!;
    expect(await signTenantAsset(key, 7, 'secret')).toBeNull();
  });

  it('are readable only through readPrivateObject, and only by their own tenant', async () => {
    const { b } = bucket();
    const key = (await storePrivateObject(b, 7, 'dsr', 'x.json', '{"a":1}', 'application/json'))!;
    expect(await readPrivateObject(b, key, 7)).toBeInstanceOf(Response);
    expect(await readPrivateObject(b, key, 8)).toBe('not-found');
    // an ordinary asset key is not a private object either
    expect(await readPrivateObject(b, '7/u/1-a.png', 7)).toBe('not-found');
  });

  it('can be deleted (on delivery / expiry), but only by their own tenant', async () => {
    const { b, store } = bucket();
    const key = (await storePrivateObject(b, 7, 'dsr', 'x.json', '{}', 'application/json'))!;
    expect(await deletePrivateObject(b, key, 8)).toBe(false);
    expect(store.has(key)).toBe(true);
    expect(await deletePrivateObject(b, key, 7)).toBe(true);
    expect(store.has(key)).toBe(false);
  });
});

describe('private canvas media (visibility=private)', () => {
  const file = { name: 'shot.png', type: 'image/png', size: 4, stream: () => new ReadableStream() } as unknown as File;
  const fileBucket = () => {
    const objects = new Map<string, { body: string; type: string }>();
    return {
      objects,
      put: vi.fn(async (key: string, _b: unknown, o: { httpMetadata: { contentType: string } }) => { objects.set(key, { body: 'x', type: o.httpMetadata.contentType }); }),
      get: vi.fn(async (key: string) => (objects.has(key) ? { body: 'x', httpMetadata: { contentType: objects.get(key)!.type } } : null)),
      head: vi.fn(async (key: string) => (objects.has(key) ? { httpMetadata: { contentType: objects.get(key)!.type } } : null)),
    };
  };

  it('is stored under <tenant>/private/media/ and refused by the unauthenticated /api/assets reader', async () => {
    const b = fileBucket();
    const stored = await storeTenantAsset(b as unknown as R2Bucket, file, { tenantId: 7, userId: 'u' }, { private: true });
    const key = (stored as { key: string }).key;
    expect(key).toMatch(/^7\/private\/media\/[0-9a-f-]{36}\.png$/);
    expect(await readAssetByKey(b as unknown as R2Bucket, key)).toBe('not-found');
  });

  it('stays readable by its own tenant through the authenticated reader, with a PRIVATE cache policy', async () => {
    const b = fileBucket();
    const key = ((await storeTenantAsset(b as unknown as R2Bucket, file, { tenantId: 7, userId: 'u' }, { private: true })) as { key: string }).key;
    const res = (await readTenantAsset(b as unknown as R2Bucket, key, 7)) as Response;
    expect(res).toBeInstanceOf(Response);
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
    expect(cc).not.toContain('immutable');
    expect(await readTenantAsset(b as unknown as R2Bucket, key, 8)).toBe('not-found');
  });

  it('a public asset keeps the immutable public cache policy', async () => {
    const b = fileBucket();
    const key = ((await storeTenantAsset(b as unknown as R2Bucket, file, { tenantId: 7, userId: 'u' })) as { key: string }).key;
    const res = (await readAssetByKey(b as unknown as R2Bucket, key)) as Response;
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });
});
