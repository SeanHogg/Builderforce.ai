/**
 * The review snapshot behind Compare's stored baseline (PRD 38 §4.8): one immutable object
 * per digest, written once, and resolved back to the extracted output it names by hash.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { knowledgeBlobKeys, r2ExtractedCache } from './knowledgeBlobs';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const ROOT = 'web-vfs-1';

/** An in-memory R2 bucket: enough of get/head/put/delete/list for the adapter. */
function fakeBucket() {
  const objects = new Map<string, { body: string; customMetadata?: Record<string, string> }>();
  const puts: string[] = [];
  const bucket = {
    async get(key: string) {
      const o = objects.get(key);
      return o ? { json: async () => JSON.parse(o.body) as unknown } : null;
    },
    async head(key: string) {
      return objects.has(key) ? { key } : null;
    },
    async put(key: string, body: string, opts?: { customMetadata?: Record<string, string> }) {
      puts.push(key);
      objects.set(key, { body, ...(opts?.customMetadata ? { customMetadata: opts.customMetadata } : {}) });
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list(opts: { prefix: string }) {
      const hits = [...objects.entries()].filter(([k]) => k.startsWith(opts.prefix)).map(([key, o]) => ({ key, customMetadata: o.customMetadata }));
      return { objects: hits, truncated: false };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, puts };
}

const entry = (path: string, hash: string): Extracted => ({
  sourceRef: `src:${ROOT}::${path}`, sourceHash: hash,
  nodes: [{ ref: `src:${ROOT}::${path}`, kind: 'file', label: path, pack: 'docs', importance: 0, origin: 'extracted', sourceHash: hash }],
  edges: [], keys: [],
});

describe('review snapshots', () => {
  it('writes the snapshot once per digest and never rewrites it', async () => {
    const { bucket, objects, puts } = fakeBucket();
    const cache = r2ExtractedCache({ UPLOADS: bucket }, 4, 9);
    const key = knowledgeBlobKeys(4, 9).review(ROOT, 'd1');

    await cache.setSource(`src:${ROOT}::b.md`, 'hb');
    await cache.setSource(`src:${ROOT}::a.md`, 'ha');
    await cache.snapshotReview(ROOT, 'd1');
    expect(JSON.parse(objects.get(key)!.body)).toEqual([{ path: 'a.md', hash: 'ha' }, { path: 'b.md', hash: 'hb' }]);

    // The sources move on; the digest's snapshot does not.
    await cache.setSource(`src:${ROOT}::a.md`, 'ha2');
    await cache.snapshotReview(ROOT, 'd1');
    expect(puts.filter((k) => k === key)).toHaveLength(1);
    expect(JSON.parse(objects.get(key)!.body)).toEqual([{ path: 'a.md', hash: 'ha' }, { path: 'b.md', hash: 'hb' }]);
  });

  it('builds a past review from its snapshot by hash, while the current sources differ', async () => {
    const { bucket } = fakeBucket();
    const cache = r2ExtractedCache({ UPLOADS: bucket }, 4, 9);
    await cache.put('ha', [entry('a.md', 'ha')]);
    await cache.put('ha2', [entry('a.md', 'ha2')]);
    await cache.setSource(`src:${ROOT}::a.md`, 'ha');
    await cache.snapshotReview(ROOT, 'd1');
    await cache.setSource(`src:${ROOT}::a.md`, 'ha2');

    expect((await cache.reviewExtracted(ROOT, 'd1'))?.map((e) => e.sourceHash)).toEqual(['ha']);
    expect((await cache.rootExtracted(ROOT)).map((e) => e.sourceHash)).toEqual(['ha2']);
    expect(await cache.reviewExtracted(ROOT, 'unknown')).toBeNull();
  });
});
