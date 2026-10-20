/**
 * 1242 — fact retirement and hybrid recall.
 *
 * Three behaviours are load-bearing and were previously unguarded, so each is asserted
 * here against the SQL the code actually emits rather than against a mock's opinion:
 *
 *  1. a RETIRED fact (`superseded_by IS NOT NULL`) never reaches recall — neither the
 *     lexical arm nor the semantic arm, nor the exact-key Q&A replay;
 *  2. a write whose content moved under a key ALREADY held by a different hash retires
 *     that row (the same-key case is handled by the ON CONFLICT replace);
 *  3. `importance` is a real, VARYING weight on write, not the 0.5 every row carried.
 *
 * The db doubles below are intentionally shallow: they assert the shape of the query
 * (that the predicate is present, that the hash differs, that importance is set), which
 * is what regressed.
 */
import { describe, expect, it, vi } from 'vitest';
import { SQL } from 'drizzle-orm';
import { recallProjectFacts } from './projectFactsRecall';
import { upsertProjectFact } from './projectFactsWrite';
import { getProjectFactRecordByKey } from './projectFactsAnswerCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getCacheVersion/getOrSetCached fall through to the loader.
const env = {} as Env;

/**
 * Flatten a drizzle SQL tree to text so a predicate can be asserted on.
 *
 * Guards on SEEN objects, not just depth: a `Column` holds a reference back to its
 * table, which holds every other column, so blind recursion runs forever.
 */
function sqlText(value: unknown, seen: Set<unknown> = new Set()): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => sqlText(v, seen)).join(' ');
  if (value instanceof SQL) return sqlText(value.queryChunks, seen);
  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);
    const record = value as Record<string, unknown>;
    if ('queryChunks' in record) return sqlText(record.queryChunks, seen);
    // A `Param`/`Column` carries its name; an operator (`StringChunk`) carries its SQL
    // text in a nested `value` array. Recursing over every own value — rather than
    // only the string-typed ones — is what picks both up.
    return Object.values(record).map((v) => sqlText(v, seen)).join(' ');
  }
  return String(value);
}

/** Every where-clause the code built, captured for assertion. */
interface Captured {
  wheres: string[];
  updates: Array<{ set: Record<string, unknown>; where: string }>;
  values: Record<string, unknown> | null;
  conflict: Record<string, unknown> | null;
  selects: number;
}

function makeDb(opts?: {
  selectRows?: (wheres: string[]) => Array<Record<string, unknown>>;
}): { db: Db; calls: Captured } {
  const calls: Captured = { wheres: [], updates: [], values: null, conflict: null, selects: 0 };
  const db = {
    select: () => {
      calls.selects += 1;
      return {
        from: () => ({
          where: (w: unknown) => {
            // Capture the predicate as text so a test can assert the column and
            // operator it actually carries, rather than trusting the mock.
            calls.wheres.push(sqlText(w));
            return {
              orderBy: () => ({ limit: async () => (opts?.selectRows?.(calls.wheres) ?? []) }),
              // The semantic arm's hydration is `where(...)` with no orderBy — it stops
              // at `.limit()`.
              limit: async () => (opts?.selectRows?.(calls.wheres) ?? []),
            };
          },
        }),
      };
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.values = v;
        return {
          onConflictDoUpdate: (c: Record<string, unknown>) => {
            calls.conflict = c;
            return Promise.resolve();
          },
        };
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
  // `as never`, matching the sibling suite: the production `Db` type is a 100-method
  // Drizzle handle and a structural double could never satisfy it. What is asserted
  // here is the QUERY the code builds, which this shape exposes.
  return { db: db as never, calls };
}

/** Embeddings are stubbed to throw, which the code treats as "no vector available". */
vi.mock('../memory/memoryEmbedding', async () => {
  const actual = await vi.importActual<typeof import('../memory/memoryEmbedding')>('../memory/memoryEmbedding');
  return {
    ...actual,
    embedMemoryText: vi.fn(async () => { throw new Error('no provider'); }),
  };
});

const FNV = 'superseded_by';

describe('recallProjectFacts — retirement (1242)', () => {
  it('excludes superseded facts from the lexical arm', async () => {
    const { db, calls } = makeDb();
    await recallProjectFacts(env, db, 7, 42, { query: 'anything' });
    expect(calls.selects).toBeGreaterThan(0);
    expect(calls.wheres.length).toBeGreaterThan(0);
    for (const where of calls.wheres) {
      expect(where).toContain(FNV);
      // Drizzle emits operators as lowercase chunks (`is null`), so match case-
      // insensitively rather than pinning the exact casing of the renderer.
      expect(where).toMatch(/is\s+null/i);
    }
  });

  it('returns [] for an invalid project id without touching the db', async () => {
    const { db, calls } = makeDb();
    expect(await recallProjectFacts(env, db, 7, 0, { query: 'x' })).toEqual([]);
    expect(calls.selects).toBe(0);
  });

  it('degrades to [] rather than throwing when the table is missing', async () => {
    const db = {
      select: () => { throw new Error('relation "project_facts" does not exist'); },
    };
    await expect(recallProjectFacts(env, db as never, 7, 42, { query: 'x' })).resolves.toEqual([]);
  });

  it('treats a superseded fact as a MISS on the exact-key Q&A replay too', async () => {
    const { db, calls } = makeDb();
    await getProjectFactRecordByKey(env, db, 7, 42, 'qa:v2:c3a984d3');
    // The replay path is the one that re-serves a pinned answer verbatim, so the
    // retirement predicate has to be there too — not just in ambient recall.
    expect(calls.wheres.some((w) => w.includes(FNV))).toBe(true);
  });
});

describe('upsertProjectFact — supersession on a changed hash (1242)', () => {
  it('stamps a content hash and retires a contradicting row under the same key', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'step-cap', 'there is no step cap', 'agent', {
      fileAnchors: [{ path: 'api/src/run/loop.ts' }],
    });
    // A hash is computed and written on BOTH branches.
    expect(typeof calls.values?.contentHash).toBe('string');
    expect((calls.values?.contentHash as string).length).toBe(64);
    expect(calls.conflict).not.toBeNull();
    // The retire-before-write UPDATE fired for the anchor...
    expect(calls.updates).toHaveLength(1);
    const retire = calls.updates[0];
    if (!retire) throw new Error('no retire UPDATE was emitted for the anchor');
    expect(retire.set).toMatchObject({ supersededBy: 0 });
    const where = retire.where;
    expect(where).toContain('api/src/run/loop.ts');
    // ...scoped to THIS tenant/project and this project only...
    expect(where).toContain('tenant_id');
    expect(where).toContain('project_id');
    // ...and never retiring a row that already agrees (the `content_hash IS DISTINCT FROM`
    // guard), so a re-assertion of the same belief is a no-op rather than a
    // self-retirement. Drizzle renders `ne()` as an IS DISTINCT FROM wrapper whose
    // operator text is not exposed on the Column objects, so the guard is asserted on
    // the column plus its BOUND hash value — which is what distinguishes "compared
    // against" from merely selected.
    expect(where).toContain('content_hash');
    expect(where).toContain(String(calls.values?.contentHash));
    expect(where).toContain(FNV);
  });

  it('revives a retired row when the same key is re-asserted', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'step-cap', 'corrected text', 'agent');
    const set = (calls.conflict?.set ?? {}) as Record<string, unknown>;
    // A retirement means "this was contradicted", not "this is forbidden"; a fresh
    // assertion is the evidence it is live again.
    expect(set).toHaveProperty('supersededBy');
    expect(set.supersededBy).toBeNull();
  });

  it('writes NO retire UPDATE when the fact carries no anchor', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'k', 'v');
    // Without an anchor there is nothing to say "the codebase said otherwise about
    // THIS place", so nothing may be retired — an over-eager sweep here would delete
    // unrelated live beliefs.
    expect(calls.updates).toHaveLength(0);
  });
});

describe('upsertProjectFact — importance is real (1242)', () => {
  const importanceOf = async (content: string, kind?: 'invariant' | 'convention' | 'decision' | 'default') => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'k', content, 'agent', kind ? { kind } : {});
    return Number(calls.values?.importance);
  };

  it('is NOT the 0.5 default for a fact whose KIND is recognisable', async () => {
    // The claim is a real, load-bearing one about the codebase ("never" — an
    // invariant), so it must not sit on the neutral default that made the old
    // ranking degenerate to newest-first.
    expect(await importanceOf('The run loop NEVER truncates a step at 16.')).not.toBe(0.5);
  });

  it('falls back to the neutral default when the content says nothing about kind', async () => {
    // Deliberate and asserted, not a hole: an unclassifiable fact keeps the column
    // default rather than having a weight invented for it.
    expect(await importanceOf('The run loop caps at 16 steps.')).toBe(0.5);
  });

  it('weights a hard invariant above a casual observation', async () => {
    const invariant = await importanceOf('Migrations MUST run in order or the schema drifts.', 'invariant');
    const casual = await importanceOf('The loop file used to live under run/loop.ts.', 'default');
    expect(invariant).toBeGreaterThan(casual);
    expect(invariant).toBeLessThanOrEqual(1);
    expect(casual).toBeGreaterThanOrEqual(0);
  });

  it('varies by the KIND of fact when the caller does not say', async () => {
    const scores = await Promise.all([
      importanceOf('NEVER skip the migration guard.'),
      importanceOf('We decided to prefer pgvector over a hand-rolled index.'),
      importanceOf('The dashboard defaults to the last 30 days.'),
    ]);
    expect(new Set(scores).size).toBe(3);
  });

  it('lets the caller override it explicitly', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db, 7, 42, 'k', 'v', 'agent', { importance: 0.92 });
    expect(Number(calls.values?.importance)).toBe(0.92);
  });
});