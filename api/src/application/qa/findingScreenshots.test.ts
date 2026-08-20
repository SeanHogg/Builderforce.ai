/**
 * Contract tests for QA finding screenshots.
 *
 * The security property under test is the one that lets the read endpoint skip a
 * database lookup: the TENANT IS IN THE KEY, so authorization is a prefix test.
 * If that ever stopped holding, one workspace could read another's page images
 * by guessing a key — so the cross-tenant cases below are the point of the file,
 * not an afterthought.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_SCREENSHOT_BYTES,
  getFindingScreenshot,
  putFindingScreenshot,
  screenshotKeyBelongsToTenant,
  screenshotPrefix,
} from './findingScreenshots';

const bytes = (n: number) => new Uint8Array(n).buffer;

function fakeBucket() {
  const store = new Map<string, { value: ArrayBuffer; contentType: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { value, contentType: opts?.httpMetadata?.contentType ?? '' });
    },
    async get(key: string) {
      const hit = store.get(key);
      if (!hit) return null;
      return { body: 'stream' as unknown as ReadableStream, size: hit.value.byteLength, httpMetadata: { contentType: hit.contentType } };
    },
  };
}
const asBucket = (b: ReturnType<typeof fakeBucket>) => b as unknown as R2Bucket;

describe('screenshot key ownership', () => {
  it('accepts only keys under the caller tenant prefix', () => {
    const key = `${screenshotPrefix(7)}exp-1/abc.png`;
    expect(screenshotKeyBelongsToTenant(key, 7)).toBe(true);
    expect(screenshotKeyBelongsToTenant(key, 8)).toBe(false);
  });

  // `qa/screenshots/7/` must not match tenant 77's prefix or vice versa — the
  // trailing slash is what stops the numeric prefix collision.
  it('does not let tenant 7 read tenant 77 (or the reverse)', () => {
    expect(screenshotKeyBelongsToTenant(`${screenshotPrefix(77)}e/a.png`, 7)).toBe(false);
    expect(screenshotKeyBelongsToTenant(`${screenshotPrefix(7)}e/a.png`, 77)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['traversal', 'qa/screenshots/7/../8/a.png'],
    ['backslashes', 'qa\\screenshots\\7\\a.png'],
    ['another key space', 'ide/projects/7/App.js'],
    ['overlong', `${'a'.repeat(600)}`],
  ])('rejects %s', (_label, key) => {
    expect(screenshotKeyBelongsToTenant(key, 7)).toBe(false);
  });
});

describe('putFindingScreenshot', () => {
  it('stores a PNG under the tenant + exploration prefix and returns its key', async () => {
    const bucket = fakeBucket();
    const res = await putFindingScreenshot(asBucket(bucket), {
      tenantId: 7, explorationId: 'exp-1', contentType: 'image/png', bytes: bytes(128),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key.startsWith('qa/screenshots/7/exp-1/')).toBe(true);
    expect(res.key.endsWith('.png')).toBe(true);
    expect(bucket.store.has(res.key)).toBe(true);
  });

  it('tolerates a charset-suffixed content type', async () => {
    const res = await putFindingScreenshot(asBucket(fakeBucket()), {
      tenantId: 1, explorationId: 'e', contentType: 'image/png; charset=binary', bytes: bytes(10),
    });
    expect(res.ok).toBe(true);
  });

  it.each([
    ['a non-image type', 'text/html', 4, 415],
    ['an empty body', 'image/png', 0, 400],
  ])('refuses %s', async (_label, contentType, size, status) => {
    const bucket = fakeBucket();
    const res = await putFindingScreenshot(asBucket(bucket), {
      tenantId: 1, explorationId: 'e', contentType, bytes: bytes(size),
    });
    expect(res).toMatchObject({ ok: false, status });
    expect(bucket.store.size).toBe(0);
  });

  it('refuses an oversized image rather than filling the bucket', async () => {
    const res = await putFindingScreenshot(asBucket(fakeBucket()), {
      tenantId: 1, explorationId: 'e', contentType: 'image/png', bytes: bytes(MAX_SCREENSHOT_BYTES + 1),
    });
    expect(res).toMatchObject({ ok: false, status: 413 });
  });

  it('reports 503 rather than throwing when storage is unconfigured', async () => {
    const res = await putFindingScreenshot(undefined, {
      tenantId: 1, explorationId: 'e', contentType: 'image/png', bytes: bytes(4),
    });
    expect(res).toMatchObject({ ok: false, status: 503 });
  });
});

describe('getFindingScreenshot', () => {
  it('round-trips a stored image for its own tenant', async () => {
    const bucket = fakeBucket();
    const put = await putFindingScreenshot(asBucket(bucket), {
      tenantId: 7, explorationId: 'exp-1', contentType: 'image/png', bytes: bytes(64),
    });
    if (!put.ok) throw new Error('setup failed');
    const got = await getFindingScreenshot(asBucket(bucket), 7, put.key);
    expect(got).toMatchObject({ contentType: 'image/png', size: 64 });
  });

  it('returns null for another tenant WITHOUT touching storage', async () => {
    const bucket = fakeBucket();
    const put = await putFindingScreenshot(asBucket(bucket), {
      tenantId: 7, explorationId: 'exp-1', contentType: 'image/png', bytes: bytes(64),
    });
    if (!put.ok) throw new Error('setup failed');
    const get = vi.spyOn(bucket, 'get');
    expect(await getFindingScreenshot(asBucket(bucket), 8, put.key)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('returns null for a missing object and for unconfigured storage', async () => {
    const bucket = fakeBucket();
    expect(await getFindingScreenshot(asBucket(bucket), 7, `${screenshotPrefix(7)}e/ghost.png`)).toBeNull();
    expect(await getFindingScreenshot(undefined, 7, `${screenshotPrefix(7)}e/a.png`)).toBeNull();
  });
});
