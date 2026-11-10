/**
 * Extracted bundles (PRD 41 A11 rule 4a): one content-addressed object per pack, read back by ranged GET through
 * the index, with the legacy per-hash object as the fallback.
 */
import { describe, expect, it } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { buildBundle, bundlePrefix, mergeBody, readBundled } from './knowledgeBundles';
import { r2ExtractedCache } from './knowledgeBlobs';
import type { ExtractedLoc, KnowledgeLedgerPort } from './knowledgeLedger';

const body = (n: number, nodes = 3): Extracted[] => [{
  sourceRef: `src:r::f${n}.ts` as never, sourceHash: `h${n}`,
  nodes: Array.from({ length: nodes }, (_, i) => ({ ref: `src:r::f${n}.ts#${i}` as never, kind: 'symbol', label: `n${i}`, pack: 'code', importance: 0.1, origin: 'extracted' as const })),
  edges: [], keys: [],
}];

/** An R2 bucket in memory that counts its reads by kind. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const log = { ranged: [] as Array<{ key: string; offset: number; length: number }>, whole: 0, puts: [] as string[] };
  const bucket = {
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const o = objects.get(key);
      if (!o) return null;
      if (opts?.range) log.ranged.push({ key, ...opts.range });
      else log.whole += 1;
      const slice = opts?.range ? o.bytes.subarray(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes;
      return { arrayBuffer: async () => slice.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(slice)), customMetadata: o.meta };
    },
    async put(key: string, value: string | Uint8Array) {
      log.puts.push(key);
      objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value });
    },
    async head(key: string) { return objects.has(key) ? {} : null; },
    async delete() { return undefined; },
    async list() { return { objects: [], truncated: false }; },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, log };
}

describe('extracted bundles', () => {
  it('lays bodies end to end under a key that is the content, and records each body\'s range and sources', () => {
    const a = buildBundle(7, [{ hash: 'h1', entries: body(1) }, { hash: 'h2', entries: body(2) }]);
    const again = buildBundle(7, [{ hash: 'h1', entries: body(1) }, { hash: 'h2', entries: body(2) }]);
    expect(a.key).toBe(again.key);                       // retried pack, same object
    expect(a.key.startsWith(bundlePrefix(7))).toBe(true);
    expect(buildBundle(7, [{ hash: 'h1', entries: body(1) }]).key).not.toBe(a.key);
    expect(a.locs[1]!.byteOffset).toBe(a.locs[0]!.byteLength);
    expect(a.locs[0]!.sourceRefs).toEqual(['src:r::f1.ts']);
  });

  it('reads bodies with ranged GETs, coalescing neighbours into windows (a handful of reads for many bodies)', async () => {
    const { bucket, objects, log } = fakeBucket();
    const bundle = buildBundle(7, Array.from({ length: 300 }, (_, i) => ({ hash: `h${i}`, entries: body(i) })));
    objects.set(bundle.key, { bytes: bundle.bytes });
    const got = await readBundled(bucket, bundle.locs);
    expect(got.size).toBe(300);
    expect(got.get('h42')).toEqual(body(42));
    expect(log.whole).toBe(0);
    expect(log.ranged.length).toBeLessThanOrEqual(Math.ceil(bundle.bytes.length / (4 * 1024 * 1024)) + 1);
    // Two far-apart bodies are two windows, each exactly its own bytes.
    log.ranged.length = 0;
    const far = [bundle.locs[0]!, bundle.locs[299]!];
    await readBundled(bucket, far);
    expect(log.ranged).toHaveLength(2);
    expect(log.ranged[0]).toMatchObject({ offset: far[0]!.byteOffset, length: far[0]!.byteLength });
  });

  it('r2ExtractedCache.get resolves through the index with a ranged read, and falls back to the legacy per-hash object', async () => {
    const { bucket, objects, log } = fakeBucket();
    const bundle = buildBundle(4, [{ hash: 'h1', entries: body(1) }, { hash: 'h2', entries: body(2) }]);
    objects.set(bundle.key, { bytes: bundle.bytes });
    const rows = new Map<string, ExtractedLoc>(bundle.locs.map((l) => [l.hash, l]));
    const ledger = { index: { locate: async (hs: readonly string[]) => hs.flatMap((h) => (rows.has(h) ? [rows.get(h)!] : [])), upsert: async () => undefined }, sources: {} } as unknown as KnowledgeLedgerPort;
    const cache = r2ExtractedCache({ UPLOADS: bucket }, 4, 9, ledger);

    expect(await cache.get('h2')).toEqual(body(2));
    expect(log.ranged).toHaveLength(1);
    expect(log.ranged[0]).toMatchObject({ key: bundle.key, offset: bundle.locs[1]!.byteOffset, length: bundle.locs[1]!.byteLength });

    // Written before bundles existed: no index row, so the per-hash object answers.
    objects.set('knowledge/4/9/extracted/old.json', { bytes: new TextEncoder().encode(JSON.stringify(body(9))) });
    expect(await cache.get('old')).toEqual(body(9));
    expect(await cache.get('nowhere')).toBeUndefined();
    // And without a ledger at all, only the legacy object exists.
    expect(await r2ExtractedCache({ UPLOADS: bucket }, 4, 9).get('old')).toEqual(body(9));
    expect(await r2ExtractedCache({ UPLOADS: bucket }, 4, 9).get('h2')).toBeUndefined();
  });
});

describe('mergeBody keeps entry-less sources apart from entries', () => {
  const loc = { sourceRefs: ['src:r::a.ts', 'entryless:src:r::bin.png'] };

  it('regression: carries an already-held entry-less source only when the stored body was actually read', () => {
    expect(mergeBody(loc, [], []).entryless).toEqual(['src:r::bin.png']);
    expect(mergeBody(loc, undefined, []).entryless).toEqual([]); // unreadable object: nothing stays "held"
  });

  it('a real entry for a source ends its entry-less state, and the bundle names it as a real ref', () => {
    const real = body(1);
    const merged = mergeBody(loc, [], real, ['src:r::f1.ts']);
    expect(merged.entryless).toEqual(['src:r::bin.png']);
    expect(buildBundle(1, [{ hash: 'h', ...merged }]).locs[0]!.sourceRefs).toEqual(['src:r::f1.ts', 'entryless:src:r::bin.png']);
  });
});

describe('mergeBody: a newer extractor wins (PRD 43 P0b, mixed-version clients)', () => {
  const at = (version: number | undefined, tag: string): Extracted => ({ ...body(1)[0]!, ...(version !== undefined ? { extractorVersion: version } : {}), keys: [{ ref: 'src:r::f1.ts' as never, key: tag }] });

  it('regression: an older client\'s entry never evicts a newer one for the same source; a same-or-newer arrival replaces it', () => {
    expect(mergeBody(undefined, [at(5, 'new')], [at(4, 'old')]).entries).toEqual([at(5, 'new')]);
    expect(mergeBody(undefined, [at(5, 'a')], [at(5, 'b')]).entries).toEqual([at(5, 'b')]);
    expect(mergeBody(undefined, [at(4, 'old')], [at(5, 'new')]).entries).toEqual([at(5, 'new')]);
    expect(mergeBody(undefined, [at(5, 'new')], [at(undefined, 'unversioned')]).entries).toEqual([at(5, 'new')]);
  });
});
