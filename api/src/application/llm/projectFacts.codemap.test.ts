/**
 * Code maps in the project-facts store (cost-lever parity WS-M):
 *
 *  1. a map write never retires other facts by anchor, and an ordinary fact's anchor
 *     sweep never retires a map — retirement of a map is by its own key;
 *  2. a merged map stores the UNION of the prior map's and this write's anchors, limited
 *     to the files the merged map lists;
 *  3. at recall a changed file drops from the map — the map itself stays;
 *  4. the area-targeted recall picks the maps for the areas a query names (paths and
 *     words), and the run-context memory block leads with them.
 */
import { describe, expect, it, vi } from 'vitest';
import { SQL } from 'drizzle-orm';
import { upsertProjectFact } from './projectFactsWrite';
import { buildProjectFactsBlock, recallProjectFacts } from './projectFactsRecall';
import { MAX_CODEMAP_ANCHORS, codemapAnchorsForWrite, codemapWriteAnchors, pathKey, withCurrentAnchors } from './projectFactsCodemap';
import { areasForQuery, recallAreaCodemaps } from './projectFactsAreaRecall';
import type { Env } from '../../env';

const env = {} as Env;

vi.mock('../memory/memoryEmbedding', async () => {
  const actual = await vi.importActual<typeof import('../memory/memoryEmbedding')>('../memory/memoryEmbedding');
  return { ...actual, embedMemoryText: vi.fn(async () => { throw new Error('no provider'); }) };
});

/** Flatten a drizzle SQL tree to text (guards on seen objects: columns point back at tables). */
function sqlText(value: unknown, seen: Set<unknown> = new Set()): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => sqlText(v, seen)).join(' ');
  if (value instanceof SQL) return sqlText(value.queryChunks, seen);
  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);
    const record = value as Record<string, unknown>;
    if ('queryChunks' in record) return sqlText(record.queryChunks, seen);
    return Object.values(record).map((v) => sqlText(v, seen)).join(' ');
  }
  return String(value);
}

interface Captured {
  updates: Array<{ set: Record<string, unknown>; where: string }>;
  values: Record<string, unknown> | null;
}

/** A shallow Drizzle double: every select resolves to `rows`. */
function makeDb(rows: Array<Record<string, unknown>> = []): { db: never; calls: Captured } {
  const calls: Captured = { updates: [], values: null };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => rows }),
          limit: async () => rows,
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.values = v;
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: (w: unknown) => {
          calls.updates.push({ set: s, where: sqlText(w) });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as never, calls };
}

const MAP = [
  'Code map for `w/s` (mapped 2026-10-20).',
  'Open these first instead of searching:',
  '- w/s/a.ts',
  '- w/s/b.ts',
  '- w/s/c.ts (changed)',
].join('\n');

describe('upsertProjectFact — a code map retires by key only', () => {
  it('emits no anchor retire for a map, however many files it anchors', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'codemap:w/s', MAP, 'agent', {
      fileAnchors: [{ path: 'w/s/a.ts', contentHash: 'h' }, { path: 'w/s/b.ts', contentHash: 'h' }],
    });
    expect(calls.updates).toHaveLength(0);
    expect(calls.values?.key).toBe('codemap:w/s');
  });

  it('keeps maps out of an ordinary fact\'s anchor sweep', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'step-cap', 'there is no step cap', 'agent', {
      fileAnchors: [{ path: 'w/s/a.ts', contentHash: 'h' }],
    });
    expect(calls.updates).toHaveLength(1);
    const where = calls.updates[0]!.where;
    expect(where).toContain('w/s/a.ts');
    expect(where).toContain('codemap:%');
  });
});

describe('upsertProjectFact — a merged map carries the union of anchors', () => {
  it('stores this write\'s anchors, then the prior\'s, only for files the merged map lists', async () => {
    const prior = {
      recallCount: 0, content: MAP, expiresAt: null, supersededBy: null,
      fileAnchors: [
        { path: 'w/s/a.ts', contentHash: 'p-a' },
        { path: 'w/s/b.ts', contentHash: 'p-b' },
        { path: 'w/s/c.ts', contentHash: 'p-c' },
        { path: 'w/s/gone.ts', contentHash: 'p-gone' },
      ],
    };
    const { db, calls } = makeDb([prior]);
    const next = ['Code map for `w/s` (mapped 2026-10-26).', 'Open these first instead of searching:', '- w/s/d.ts (changed)', '- w/s/e.ts', '- w/s/a.ts (changed)'].join('\n');
    await upsertProjectFact(env, db, 7, 42, 'codemap:w/s', next, 'agent', {
      fileAnchors: [{ path: 'w/s/d.ts', contentHash: 'n-d' }, { path: 'w/s/e.ts', contentHash: 'n-e' }, { path: 'w/s/a.ts', contentHash: 'n-a' }],
    });
    expect(calls.values?.fileAnchors).toEqual([
      { path: 'w/s/d.ts', contentHash: 'n-d' },
      { path: 'w/s/e.ts', contentHash: 'n-e' },
      { path: 'w/s/a.ts', contentHash: 'n-a' },
      { path: 'w/s/b.ts', contentHash: 'p-b' },
      { path: 'w/s/c.ts', contentHash: 'p-c' },
    ]);
  });

  it('keeps the prior map\'s anchors when this write names none', () => {
    expect(codemapWriteAnchors(MAP, [{ path: 'w/s/a.ts', contentHash: 'p-a' }], undefined)).toEqual([{ path: 'w/s/a.ts', contentHash: 'p-a' }]);
    expect(codemapWriteAnchors(MAP, null, null)).toBeNull();
  });
});

describe('withCurrentAnchors — staleness per file for a map', () => {
  const map = {
    key: 'codemap:w/s',
    content: MAP,
    fileAnchors: [{ path: 'w/s/a.ts', contentHash: 'h-a' }, { path: 'w/s/b.ts', contentHash: 'h-b' }, { path: 'w/s/c.ts', contentHash: 'h-c' }],
  };

  it('drops the changed file and keeps the map', async () => {
    const out = await withCurrentAnchors(map, async (p) => (p === 'w/s/a.ts' ? 'edited' : `h-${p.slice(-4, -3)}`));
    expect(out).not.toBeNull();
    expect(out!.content).not.toContain('w/s/a.ts');
    expect(out!.content).toContain('- w/s/b.ts');
    expect(out!.fileAnchors?.map((a) => a.path)).toEqual(['w/s/b.ts', 'w/s/c.ts']);
  });

  it('hides the map only once every listed file changed', async () => {
    expect(await withCurrentAnchors(map, async () => 'edited')).toBeNull();
  });

  it('serves the map unchanged when nothing changed or nothing can be read', async () => {
    expect(await withCurrentAnchors(map, async () => null)).toBe(map);
  });

  it('still hides an ordinary fact whose anchor changed', async () => {
    const fact = { key: 'step-cap', content: 'no cap', fileAnchors: [{ path: 'x.ts', contentHash: 'old' }] };
    expect(await withCurrentAnchors(fact, async () => 'new')).toBeNull();
    expect(await withCurrentAnchors(fact, async () => 'old')).toBe(fact);
  });
});

describe('recallProjectFacts — a changed file does not hide its map', () => {
  it('serves the map without the changed file and hides the stale ordinary fact', async () => {
    const { db } = makeDb([
      { key: 'codemap:w/s', content: MAP, expiresAt: null, importance: 0.5, fileAnchors: [{ path: 'w/s/a.ts', contentHash: 'h-a' }, { path: 'w/s/b.ts', contentHash: 'h-b' }] },
      { key: 'step-cap', content: 'there is no step cap', expiresAt: null, importance: 0.5, fileAnchors: [{ path: 'x.ts', contentHash: 'h-x' }] },
    ]);
    const facts = await recallProjectFacts(env, db, 7, 42, { readFileHash: async (p) => (p === 'w/s/a.ts' || p === 'x.ts' ? 'edited' : 'h-b') });
    expect(facts.map((f) => f.key)).toEqual(['codemap:w/s']);
    expect(facts[0]!.content).not.toContain('w/s/a.ts');
    expect(facts[0]!.content).toContain('- w/s/b.ts');
  });
});

describe('area-targeted code-map recall', () => {
  const rows = [
    { key: 'codemap:brain-embedded/src/runStore', content: 'Code map for runStore\n- brain-embedded/src/runStore/runLoop.ts', expiresAt: null, fileAnchors: null },
    { key: 'codemap:api/src/application/llm', content: 'Code map for llm\n- api/src/application/llm/projectFactsWrite.ts', expiresAt: null, fileAnchors: null },
    { key: 'codemap:(root)', content: 'Code map for root\n- package.json', expiresAt: null, fileAnchors: null },
  ];

  it('reads areas off the paths a query names and the stored areas it names by word', () => {
    const stored = rows.map((r) => r.key.slice('codemap:'.length));
    expect(areasForQuery('fix api/src/application/llm/projectFactsRecall.ts', stored)).toEqual(['api/src/application/llm']);
    expect(areasForQuery('the run store drops a steer', stored)).toEqual(['brain-embedded/src/runStore']);
    expect(areasForQuery('bump package.json', stored)).toEqual(['(root)']);
  });

  it('returns the maps for the named areas only', async () => {
    const { db } = makeDb(rows);
    expect((await recallAreaCodemaps(env, db, 7, 42, 'why does the runStore retry?')).map((f) => f.key)).toEqual(['codemap:brain-embedded/src/runStore']);
    expect((await recallAreaCodemaps(env, db, 7, 42, 'bump package.json')).map((f) => f.key)).toEqual(['codemap:(root)']);
    expect(await recallAreaCodemaps(env, db, 7, 42, 'nothing about any area')).toEqual([]);
    expect(await recallAreaCodemaps(env, db, 7, 42, '   ')).toEqual([]);
  });

  it('leads the run-context memory block with the area\'s map, listed once', async () => {
    const { db, calls } = makeDb([
      ...rows.map((r) => ({ ...r, importance: 0.5 })),
      { key: 'learned:x', content: 'Invoices are raised once per order.', expiresAt: null, importance: 0.5, fileAnchors: null },
    ]);
    const block = await buildProjectFactsBlock(env, db, 7, 42, 'the run store drops a steer', { readFileHash: async () => null });
    const lines = block.split('\n');
    expect(lines[1]).toBe('- Code map for runStore');
    expect(block.split('Code map for runStore').length - 1).toBe(1);
    expect(block).toContain('Invoices are raised once per order.');
    // Served maps are stamped as recalled.
    expect(calls.updates.some((u) => 'recallCount' in u.set)).toBe(true);
  });
});

describe('upsertProjectFact — a map written without anchors (on-prem / V2 relay / cloud)', () => {
  it('derives path anchors from the listed files and hashes them from the host directory index', async () => {
    // Every select resolves to this row: the prior read sees no prior (no `key`/content), the
    // host-directory hash read sees `contentHash`.
    const { db, calls } = makeDb([{ recallCount: 0, content: null, expiresAt: null, supersededBy: 1, contentHash: 'idx' }]);
    await upsertProjectFact(env, db, 7, 42, 'codemap:w/s', MAP, 'agent');
    expect(calls.values?.fileAnchors).toEqual([
      { path: 'w/s/a.ts', contentHash: 'idx' },
      { path: 'w/s/b.ts', contentHash: 'idx' },
      { path: 'w/s/c.ts', contentHash: 'idx' },
    ]);
  });

  it('keeps the prior map hash for a file this write did not list, and anchors every listed file', () => {
    const merged = [MAP, '- w/s/d.ts'].join('\n');
    const incoming = ['Code map for `w/s` (mapped 2026-10-26).', '- w/s/d.ts'].join('\n');
    expect(codemapAnchorsForWrite(merged, incoming, [{ path: 'w/s/a.ts', contentHash: 'p-a' }], undefined)).toEqual([
      { path: 'w/s/d.ts' },
      { path: 'w/s/a.ts', contentHash: 'p-a' },
      { path: 'w/s/b.ts' },
      { path: 'w/s/c.ts' },
    ]);
  });

  it('uses the caller anchors when it sent some (the VSIX path) and caps the set', () => {
    expect(codemapAnchorsForWrite(MAP, MAP, null, [{ path: 'w/s/b.ts', contentHash: 'n-b' }])).toEqual([
      { path: 'w/s/b.ts', contentHash: 'n-b' },
      { path: 'w/s/a.ts' },
      { path: 'w/s/c.ts' },
    ]);
    const many = ['Code map', ...Array.from({ length: 30 }, (_, i) => `- w/s/f${i}.ts`)].join('\n');
    expect((codemapAnchorsForWrite(many, many, null, null) ?? []).length).toBeLessThanOrEqual(MAX_CODEMAP_ANCHORS);
    expect(codemapAnchorsForWrite('no files here', 'no files here', null, null)).toBeNull();
  });
});

describe('one path identity for anchors', () => {
  it('pathKey folds slashes, a leading ./ and case', () => {
    expect(pathKey(' .\\W\\s\\A.ts ')).toBe('w/s/a.ts');
    expect(pathKey('./w/s/a.ts')).toBe('w/s/a.ts');
  });

  it('the ordinary-fact anchor sweep binds pathKey values and normalises the stored path the same way', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'step-cap', 'there is no step cap', 'agent', {
      fileAnchors: [{ path: '.\\W\\s\\A.ts', contentHash: 'h' }],
    });
    const where = calls.updates[0]!.where;
    expect(where).toContain('w/s/a.ts');
    expect(where).not.toContain('A.ts');
    expect(where).toContain('regexp_replace');
    expect(where).toContain('chr(92)');
  });
});
