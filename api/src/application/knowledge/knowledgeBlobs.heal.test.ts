/**
 * The blob adapter keeps source objects by their FULL path. (A lost shared body is healed by the pack path:
 * `sync/applyKnowledgePack.hardening.test.ts` and `knowledgeHeal.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { r2ExtractedCache } from './knowledgeBlobs';
import type { KnowledgeLedgerPort } from './knowledgeLedger';
import { fakeLedger, newWorld, type World } from './sync/syncFakes.test-util';
import { refOf } from './sync/packFixtures.test-util';

vi.mock('../observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../observability/caughtErrorReporter')>()),
  reportCaughtError: vi.fn(),
}));

const ROOT_A = 'ws:a';
const enc = new TextEncoder();

let w: World;
beforeEach(() => { w = newWorld(); });

/** An R2 bucket over the world's bundle objects (whole or ranged reads). */
function bucketOver(world: World): R2Bucket {
  return {
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const bytes = world.bundles.get(key);
      if (!bytes) return null;
      const slice = opts?.range ? bytes.subarray(opts.range.offset, opts.range.offset + opts.range.length) : bytes;
      return { arrayBuffer: async () => slice.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(slice)) as unknown };
    },
    async put(key: string, body: string | Uint8Array) { world.bundles.set(key, typeof body === 'string' ? enc.encode(body) : body); },
    async delete() { /* nothing to delete */ },
    async head(key: string) { return world.bundles.has(key) ? { key } : null; },
    async list() { return { objects: [], truncated: false }; },
  } as unknown as R2Bucket;
}

const cacheOver = (ledger: KnowledgeLedgerPort) =>
  r2ExtractedCache({ UPLOADS: bucketOver(w) } as never, 1, 2, ledger);

describe('the blob adapter keeps source objects by their FULL path', () => {
  it("regression: paths 'src/C#/a.cs' and 'src/C#/b.cs' are two sources, and removing one removes only it", async () => {
    const cache = cacheOver(fakeLedger(w));
    await cache.setSource(refOf(ROOT_A, 'src/C#/a.cs') as never, 'h1');
    await cache.setSource(refOf(ROOT_A, 'src/C#/b.cs') as never, 'h2');
    expect([...w.sources.get(ROOT_A)!.values()].map((r) => r.path).sort()).toEqual(['src/C#/a.cs', 'src/C#/b.cs']);

    await cache.setSource(refOf(ROOT_A, 'src/C#/a.cs') as never, '');

    const rows = [...w.sources.get(ROOT_A)!.values()];
    expect(rows.find((r) => r.hash === 'h2')?.path).toBe('src/C#/b.cs');
    expect(rows.filter((r) => r.hash === '')).toHaveLength(1);
  });
});
