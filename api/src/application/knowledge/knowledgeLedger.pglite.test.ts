/**
 * The ledger's SQL against REAL Postgres (PGlite), with migrations 1300-1302 applied (PRD 41 A11 rules 4a-4b). The
 * in-memory fakes in `sync/syncFakes.test-util.ts` are why two bugs shipped: a NUL in a relation leaf key (Postgres rejects it
 * in `text` and `jsonb`; no fake does) and a "no other root names it" check that was not protected from a concurrent
 * pack. Here the statements run for real.
 *
 * PGlite is ONE session, so two concurrent transactions cannot block each other here: the advisory lock is proven by what
 * Postgres reports (`pg_locks`) while `exclusive` runs and after it ends, not by a second contender.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bucketOf, manifestTree, parseRelationLeafKey, relationLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Db } from '../../infrastructure/database/connection';
import { drizzleLedger, rowsOf, type ExtractedLoc, type KnowledgeLedgerPort } from './knowledgeLedger';
import { ensureBuckets, recomputeBuckets } from './knowledgeBuckets';

const migration = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)), 'utf8');

let pg: PGlite;
let db: Db;
let ledger: KnowledgeLedgerPort;
let other: KnowledgeLedgerPort;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE tenants (id serial PRIMARY KEY); CREATE TABLE projects (id serial PRIMARY KEY);
    INSERT INTO tenants DEFAULT VALUES; INSERT INTO projects DEFAULT VALUES; INSERT INTO projects DEFAULT VALUES;`);
  // 1301 is applied as it would have run before 1302 (then 1302 swaps its key), so the swap itself is tested.
  for (const m of ['1300_knowledge_extracted_index_and_sources.sql', '1301_knowledge_sync_leaves_and_roots.sql', '1302_knowledge_sync_hardening.sql']) await pg.exec(migration(m));
  db = drizzle(pg) as unknown as Db;
  ledger = drizzleLedger(db, 1, 1);
  other = drizzleLedger(db, 1, 2);
});

afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  for (const t of ['knowledge_sync_leaves', 'knowledge_sync_buckets', 'knowledge_sync_roots', 'knowledge_extracted_index', 'knowledge_sources']) await pg.exec(`DELETE FROM ${t}`);
});

const loc = (hash: string, bundleKey: string, refs: string[] = []): ExtractedLoc => ({ hash, bundleKey, byteOffset: 0, byteLength: 1, sourceRefs: refs });

describe('migration 1302', () => {
  it('re-runs cleanly and leaves the leaf primary key on the key hash', async () => {
    await pg.exec(migration('1302_knowledge_sync_hardening.sql'));
    const pk = rowsOf<{ a: string }>(await db.execute(sql`
      SELECT a.attname AS a FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'knowledge_sync_leaves'::regclass AND i.indisprimary ORDER BY a.attname`)).map((r) => r.a);
    expect(pk).toEqual(['leaf_key_hash', 'project_id', 'root_id', 'tenant_id']);
  });
});

describe('leaves', () => {
  it('regression: a relation leaf key (printable, no NUL) is stored, read back and parsed; the old NUL form cannot be stored at all', async () => {
    const r = { from: 'src:ws:a::src/a.ts', to: 'fact:claim:1', kind: 'about' };
    const key = relationLeafKey(r);
    await ledger.leaves.upsert('ws:a', [{ key, digest: 'd1' }, { key: 'a:claim:1', digest: 'd2' }]);
    expect((await ledger.leaves.all('ws:a')).map((l) => l.key).sort()).toEqual([key, 'a:claim:1'].sort());
    expect(parseRelationLeafKey([...await ledger.leaves.existing('ws:a', [key])][0]!)).toEqual(r);
    await expect(ledger.leaves.upsert('ws:a', [{ key: 'r:a\u0000b\u0000c', digest: 'x' }])).rejects.toThrow();
  });

  it('regression: a key far past an index entry (two 4 KB refs) is stored and found, because the key is hashed, not indexed', async () => {
    const long = relationLeafKey({ from: `src:ws:a::${'x'.repeat(4000)}`, to: `fact:${'y'.repeat(4000)}`, kind: 'about' });
    expect(long.length).toBeGreaterThan(8000);
    await ledger.leaves.upsert('ws:a', [{ key: long, digest: 'd' }]);
    expect([...await ledger.leaves.existing('ws:a', [long])]).toEqual([long]);
    await ledger.leaves.remove('ws:a', [long]);
    expect(await ledger.leaves.any('ws:a')).toBe(false);
  });

  it('reads every leaf of a root through keyset pages (more than one page), exactly once each', async () => {
    const rows = Array.from({ length: 12_345 }, (_, i) => ({ key: `a:fact-${i}`, digest: `d${i}` }));
    for (let i = 0; i < rows.length; i += 4000) await ledger.leaves.upsert('ws:a', rows.slice(i, i + 4000));
    await ledger.leaves.upsert('ws:b', [{ key: 'a:fact-0', digest: 'other' }]);
    const all = await ledger.leaves.all('ws:a');
    expect(all).toHaveLength(12_345);
    expect(new Set(all.map((l) => l.key)).size).toBe(12_345);
    expect(all.find((l) => l.key === 'a:fact-0')!.digest).toBe('d0'); // the other root's row is not this root's
  });

  it('upserts replace by key (not duplicate) and namedByOthers sees only OTHER roots and OTHER-root keys', async () => {
    await ledger.leaves.upsert('ws:a', [{ key: 'a:k1', digest: 'v1' }, { key: 'a:k2', digest: 'v1' }]);
    await ledger.leaves.upsert('ws:a', [{ key: 'a:k1', digest: 'v2' }]);
    expect((await ledger.leaves.all('ws:a')).find((l) => l.key === 'a:k1')!.digest).toBe('v2');
    await ledger.leaves.upsert('ws:b', [{ key: 'a:k2', digest: 'v9' }]);
    await other.leaves.upsert('ws:c', [{ key: 'a:k1', digest: 'v9' }]); // another PROJECT
    expect([...await ledger.leaves.namedByOthers('ws:a', ['a:k1', 'a:k2'])]).toEqual(['a:k2']);
    expect([...await ledger.leaves.namedByOthers('ws:b', ['a:k1', 'a:k2'])].sort()).toEqual(['a:k1', 'a:k2']);
  });
});

describe('roots (the conditional generation update)', () => {
  it('advances only from the generation it was built on: a full pack only when there is no row, a delta only at its base', async () => {
    expect(await ledger.roots.advance('ws:a', 1, 'd')).toBeNull(); // no row: a delta has nothing to advance
    expect(await ledger.roots.advance('ws:a', 0, 'd0')).toBe(1);
    expect(await ledger.roots.advance('ws:a', 0, 'dx')).toBeNull(); // a second full pack loses
    expect(await ledger.roots.advance('ws:a', 1, 'd1')).toBe(2);
    expect(await ledger.roots.advance('ws:a', 1, 'dy')).toBeNull(); // a stale delta loses
    expect(await ledger.roots.get('ws:a')).toEqual({ generation: 2, digest: 'd1' });
  });
});

describe('extracted index (the conditional upsert)', () => {
  it('inserts when the hash had no row, updates only while it still names the key the merge was built from, and counts what it wrote', async () => {
    expect(await ledger.index.upsert([loc('h1', 'b1', ['src:r::a'])], new Map([['h1', null]]))).toBe(1);
    expect(await ledger.index.upsert([loc('h1', 'b2')], new Map([['h1', null]]))).toBe(0);       // someone inserted first
    expect(await ledger.index.upsert([loc('h1', 'b2')], new Map([['h1', 'stale']]))).toBe(0);    // the key moved
    expect((await ledger.index.locate(['h1']))[0]!.bundleKey).toBe('b1');
    expect(await ledger.index.upsert([loc('h1', 'b2', ['src:r::a', 'src:s::a'])], new Map([['h1', 'b1']]))).toBe(1);
    expect((await ledger.index.locate(['h1']))[0]).toMatchObject({ bundleKey: 'b2', sourceRefs: ['src:r::a', 'src:s::a'] });
  });

  it('holds() answers per (hash, sourceRef): a hash held under another root is NOT held for this root\'s ref', async () => {
    await ledger.index.upsert([loc('h1', 'b1', ['src:ws:a::x.ts'])]);
    expect([...await ledger.index.holds([{ hash: 'h1', sourceRef: 'src:ws:a::x.ts' }, { hash: 'h1', sourceRef: 'src:ws:b::x.ts' }, { hash: 'h2', sourceRef: 'src:ws:a::x.ts' }])]).toEqual([0]);
  });
});

describe('sources (removal markers)', () => {
  it('a marker replaces a source, is listed with hash "", and dropMarkers removes only markers', async () => {
    await ledger.sources.upsert('ws:a', [{ sourceId: 'a.ts', path: 'a.ts', hash: 'h' }, { sourceId: 'b.ts', path: 'b.ts', hash: 'h' }]);
    await ledger.sources.mark('ws:a', ['a.ts']);
    expect((await ledger.sources.list('ws:a')).find((s) => s.sourceId === 'a.ts')!.hash).toBe('');
    const markers = await ledger.sources.markers(10);
    expect(markers).toEqual([{ rootId: 'ws:a', sourceId: 'a.ts' }]);
    await ledger.sources.dropMarkers([...markers, { rootId: 'ws:a', sourceId: 'b.ts' }]); // b.ts is a live source, not a marker
    expect((await ledger.sources.list('ws:a')).map((s) => s.sourceId)).toEqual(['b.ts']);
  });
});

describe('buckets (incremental digests)', () => {
  const leavesOf = (n: number) => Array.from({ length: n }, (_, i) => ({ key: i % 4 ? `a:f${i}` : relationLeafKey({ from: `src:r::${i}`, to: 'fact:x', kind: 'about' }), digest: `d${i}` }));

  it('recomputing only the touched buckets gives the same root digest as a full rebuild, through a change and a removal', async () => {
    const rows = leavesOf(500);
    await ledger.leaves.upsert('ws:a', rows);
    await ensureBuckets(ledger, 'ws:a'); // lazily filled once
    expect(await recomputeBuckets(ledger, 'ws:a', [])).toBe(manifestTree(rows).root);

    const changed = { key: rows[3]!.key, digest: 'changed' };
    await ledger.leaves.upsert('ws:a', [changed]);
    const next = rows.map((r) => (r.key === changed.key ? changed : r));
    expect(await recomputeBuckets(ledger, 'ws:a', [changed.key])).toBe(manifestTree(next).root);

    await ledger.leaves.remove('ws:a', [rows[7]!.key]);
    expect(await recomputeBuckets(ledger, 'ws:a', [rows[7]!.key])).toBe(manifestTree(next.filter((r) => r.key !== rows[7]!.key)).root);
    expect((await ledger.leaves.inBuckets('ws:a', [bucketOf(rows[3]!.key)])).map((l) => l.key)).toContain(rows[3]!.key);
  });

  it('a root with leaves but no bucket rows (written before 1302) is filled once, lazily, and gets the same digest', async () => {
    const rows = leavesOf(120);
    await ledger.leaves.upsert('ws:a', rows);
    await pg.exec(`UPDATE knowledge_sync_leaves SET bucket = NULL`);
    await pg.exec(`DELETE FROM knowledge_sync_buckets`);
    expect(await ledger.buckets.has('ws:a')).toBe(false);
    await ledger.exclusive((locked) => ensureBuckets(locked, 'ws:a'));
    expect(await ledger.buckets.has('ws:a')).toBe(true);
    expect(await recomputeBuckets(ledger, 'ws:a', [])).toBe(manifestTree(rows).root);
    expect(rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM knowledge_sync_leaves WHERE bucket IS NULL`))[0]!.n).toBe(0);
  });
});

describe('the project sync lock', () => {
  const advisory = async (): Promise<number> => rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`))[0]!.n;

  it('exclusive() holds a transaction-scoped advisory lock while it runs and releases it at commit, and rolls back on a throw', async () => {
    expect(await advisory()).toBe(0);
    await ledger.exclusive(async (locked) => {
      expect(await advisory()).toBe(1);
      await locked.leaves.upsert('ws:a', [{ key: 'a:k', digest: 'd' }]);
    });
    expect(await advisory()).toBe(0);
    expect(await ledger.leaves.any('ws:a')).toBe(true);
    await expect(ledger.exclusive(async (locked) => {
      await locked.leaves.upsert('ws:a', [{ key: 'a:rolled-back', digest: 'd' }]);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect([...await ledger.leaves.existing('ws:a', ['a:rolled-back'])]).toEqual([]);
    expect(await advisory()).toBe(0);
  });

  it('is keyed by tenant and project: different projects hash to different lock ids', async () => {
    const id = async (t: number, p: number): Promise<string> => rowsOf<{ k: string }>(await db.execute(
      sql`SELECT hashtextextended('knowledge-sync:' || ${String(t)}::text || ':' || ${String(p)}::text, 0)::text AS k`))[0]!.k;
    expect(await id(1, 1)).not.toBe(await id(1, 2));
    expect(await id(1, 1)).not.toBe(await id(2, 1));
    expect(await id(1, 1)).toBe(await id(1, 1));
    expect(other).toBeDefined();
  });
});
