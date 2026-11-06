/**
 * deleteRootSources removes a root's source objects by listing their key prefix, page by
 * page, with no extracted lookup — so a source whose extracted blob is missing goes too and
 * a root of more than one page (and more than the build's 600-blob cap) is removed whole.
 */
import { describe, expect, it, vi } from 'vitest';
import { knowledgeBlobKeys, r2ExtractedCache } from './knowledgeBlobs';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const ROOT = 'pack:docs-1a2b3c4d';

/** An in-memory R2 bucket honoring `limit`, `truncated` and array deletes. */
function pagedBucket() {
  const objects = new Map<string, string>();
  const bucket = {
    async put(key: string, body: string) { objects.set(key, body); },
    async get(key: string) { const b = objects.get(key); return b === undefined ? null : { json: async () => JSON.parse(b) as unknown }; },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k); },
    async list(opts: { prefix: string; limit?: number }) {
      const all = [...objects.keys()].filter((k) => k.startsWith(opts.prefix)).sort();
      const page = all.slice(0, opts.limit ?? 1000);
      return { objects: page.map((key) => ({ key })), truncated: all.length > page.length };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

describe('r2ExtractedCache.deleteRootSources', () => {
  it('removes every source object of a root of 1,300 sources — none of whose extracted blobs exist — and its bundle', async () => {
    const { bucket, objects } = pagedBucket();
    const keys = knowledgeBlobKeys(4, 9);
    for (let i = 0; i < 1_300; i++) objects.set(`${keys.sources(ROOT)}${i}.json`, JSON.stringify({ path: `f${i}.md`, hash: `h${i}` }));
    objects.set(keys.bundle(ROOT), '{}');
    const other = `${keys.sources('web:other')}0.json`;
    objects.set(other, '{}');

    expect(await r2ExtractedCache({ UPLOADS: bucket }, 4, 9).deleteRootSources(ROOT)).toBe(1_300);
    expect([...objects.keys()]).toEqual([other]);
  });

  it('is a no-op without storage', async () => {
    expect(await r2ExtractedCache({} as never, 4, 9).deleteRootSources(ROOT)).toBe(0);
  });
});
