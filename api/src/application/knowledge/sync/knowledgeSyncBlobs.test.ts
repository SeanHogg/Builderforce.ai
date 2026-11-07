/**
 * The real R2 adapter of pack sync (PRD 41 A11): where parts are staged and who they belong to, the cap on their
 * summed size, the one-time move of `sync.json` into the roots table, the claim a have-check makes about bundles,
 * and the batch size of legacy deletes.
 */
import { describe, expect, it } from 'vitest';
import { r2KnowledgeSync } from './knowledgeSyncBlobs';
import { KnowledgeSyncError, STAGE_TTL_MS } from './knowledgeSyncPorts';
import type { ExtractedLoc, KnowledgeLedgerPort } from '../knowledgeLedger';

function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const deleted: string[][] = [];
  const bucket = {
    async get(key: string) {
      const o = objects.get(key);
      return o ? { size: o.bytes.length, customMetadata: o.meta, arrayBuffer: async () => o.bytes.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(o.bytes)) } : null;
    },
    async head(key: string) { return objects.has(key) ? { uploaded: new Date() } : null; },
    async put(key: string, value: string | Uint8Array, opts?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value, ...(opts?.customMetadata ? { meta: opts.customMetadata } : {}) });
    },
    async delete(keys: string | string[]) { const list = Array.isArray(keys) ? keys : [keys]; deleted.push(list); for (const k of list) objects.delete(k); },
    async list(opts: { prefix: string }) { return { objects: [...objects.keys()].filter((k) => k.startsWith(opts.prefix)).map((key) => ({ key, customMetadata: objects.get(key)!.meta })), truncated: false }; },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, deleted };
}

function ledgerDouble(over: { roots?: Map<string, { generation: number; digest: string }>; locs?: ExtractedLoc[] } = {}) {
  const roots = over.roots ?? new Map<string, { generation: number; digest: string }>();
  const dropped: string[][] = [];
  const ledger = {
    roots: { get: async (r: string) => roots.get(r) ?? null, seed: async (r: string, row: { generation: number; digest: string }) => { if (!roots.has(r)) roots.set(r, row); }, clear: async (r: string) => { roots.delete(r); } },
    leaves: { clear: async () => 0 },
    index: { locate: async () => over.locs ?? [], dropBundles: async (keys: string[]) => { dropped.push(keys); } },
  } as unknown as KnowledgeLedgerPort;
  return { ledger, roots, dropped };
}

describe('r2KnowledgeSync', () => {
  it('stages parts under the tenant, beside the numeric project folders, keyed by the actor', async () => {
    const { bucket, objects } = fakeBucket();
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, ledgerDouble().ledger);
    await sync.stagePart('u1', 'sync-abcdef12', 0, new Uint8Array([1]));
    const [key] = [...objects.keys()];
    expect(key).toBe('knowledge/4/sync-stage/9/u1/sync-abcdef12/000000');
    // It cannot be mistaken for anything under a root: roots live at knowledge/4/9/<root>/…
    expect(key!.startsWith('knowledge/4/9/')).toBe(false);
    expect(await sync.stagedParts('u1', 'sync-abcdef12', 1, 1000)).toHaveLength(1);
    expect(await sync.stagedParts('u2', 'sync-abcdef12', 1, 1000)).toBeNull();
  });

  it('sums the parts as they load and refuses past the cap before joining them', async () => {
    const { bucket } = fakeBucket();
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, ledgerDouble().ledger);
    for (let i = 0; i < 3; i++) await sync.stagePart('u1', 'sync-sizes-001', i, new Uint8Array(40));
    await expect(sync.stagedParts('u1', 'sync-sizes-001', 3, 100)).rejects.toMatchObject({ status: 413, code: 'pack_too_large' });
    await expect(sync.stagedParts('u1', 'sync-sizes-001', 3, 100)).rejects.toBeInstanceOf(KnowledgeSyncError);
    expect(await sync.stagedParts('u1', 'sync-sizes-001', 3, 120)).toHaveLength(3);
  });

  it('treats an expired part as missing', async () => {
    const { bucket } = fakeBucket();
    let now = 1_000_000;
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, ledgerDouble().ledger, () => now);
    await sync.stagePart('u1', 'sync-expire-01', 0, new Uint8Array(1));
    now += STAGE_TTL_MS + 1;
    expect(await sync.stagedParts('u1', 'sync-expire-01', 1, 100)).toBeNull();
  });

  it('copies an older sync.json into the roots table on first read, then deletes the object', async () => {
    const { bucket, objects } = fakeBucket();
    objects.set('knowledge/4/9/ws%3Aa/sync.json', { bytes: new TextEncoder().encode(JSON.stringify({ generation: 5, digest: 'dd' })) });
    const d = ledgerDouble();
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, d.ledger);
    expect(await sync.state('ws:a')).toEqual({ generation: 5, digest: 'dd' });
    expect(d.roots.get('ws:a')).toEqual({ generation: 5, digest: 'dd' });
    expect(objects.has('knowledge/4/9/ws%3Aa/sync.json')).toBe(false);
    expect(await sync.state('ws:a')).toEqual({ generation: 5, digest: 'dd' });      // now from the row
    expect(await sync.state('ws:none')).toEqual({ generation: 0, digest: '' });
  });

  it('does not claim a body whose bundle object is gone: the rows are dropped and the have-check says no', async () => {
    const { bucket, objects } = fakeBucket();
    objects.set('knowledge/4/extracted-bundles/live', { bytes: new Uint8Array(1) });
    const locs: ExtractedLoc[] = [
      { hash: 'h1', bundleKey: 'knowledge/4/extracted-bundles/live', byteOffset: 0, byteLength: 1, sourceRefs: ['src:r::a'] },
      { hash: 'h2', bundleKey: 'knowledge/4/extracted-bundles/gone', byteOffset: 0, byteLength: 1, sourceRefs: ['src:r::b'] },
    ];
    const d = ledgerDouble({ locs });
    const held = await r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, d.ledger).heldBodies(['h1', 'h2']);
    expect([...held.keys()]).toEqual(['h1']);
    expect(d.dropped).toEqual([['knowledge/4/extracted-bundles/gone']]);
  });

  it('deletes legacy source objects in batches of at most 1,000 keys', async () => {
    const { bucket, deleted } = fakeBucket();
    const sync = r2KnowledgeSync({ UPLOADS: bucket }, 4, 9, ledgerDouble().ledger);
    await sync.deleteLegacySources('ws:a', Array.from({ length: 2500 }, (_, i) => `src/f${i}.ts`));
    expect(deleted.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(deleted[0]![0]).toMatch(/^knowledge\/4\/9\/ws%3Aa\/src\/[0-9a-f]+\.json$/);
  });
});
