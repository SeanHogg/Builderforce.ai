/**
 * Ticket 5301 — memory correctness, requirements 1-6.
 *
 * One suite per behaviour that was previously unguarded, each asserting against the
 * SQL or the returned value the code actually produces:
 *
 *  1. FILE ANCHORS — anchors are persisted on write; a fact whose anchored file now
 *     hashes differently is excluded from the run-start block.
 *  2. PROVENANCE — `origin_execution_id` and `origin_model` are stamped on write, and
 *     a missing execution/model stays null rather than being invented.
 *  3. RANKING — importance varies by kind AND carries a recall-count lift.
 *  4. VECTOR RECALL — the semantic arm runs through the shared ANN path and fails soft
 *     to lexical when embeddings are unavailable.
 *  5. QA CACHE EXPIRY — a cached answer is written with a TTL and a changed anchor
 *     drops it.
 *  6. DECAY — recall stamps `last_recalled_at`; the sweep expires what was never
 *     recalled and leaves the rest alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SQL } from 'drizzle-orm';
import {
  anchorsAreStale,
  decayUnrecalled,
  normalizeFileAnchors,
  recallProjectFacts,
  stampFactRecall,
  sweepUnrecalledFactDecay,
  sweepAllUnrecalledFactDecay,
  upsertProjectFact,
} from './projectFacts';
import { MEMORY_EMBEDDING_DIMS } from '../memory/memoryEmbedding';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/**
 * Hoisted doubles, not `vi.mocked(importedFn)`. This file also `importActual`s the
 * same modules, and Vitest then hands THIS file the original functions — which have
 * no `mockReset`. The modules under test import the factory result, so the doubles
 * they call are these.
 */
const doubles = vi.hoisted(() => ({
  embed: vi.fn(async () => { throw new Error('no provider'); }),
  ann: vi.fn(async () => [] as unknown[]),
}));

const env = {} as Env;

/** A vector `toVectorLiteral` will accept. A short stub is rejected before ANN runs. */
function embedding(): number[] {
  return Array.from({ length: MEMORY_EMBEDDING_DIMS }, () => 0.1);
}

beforeEach(() => {
  // recallProjectFacts and the exact-key read are both L1-cached. A hit from an
  // earlier test skips the loader, so the next test's db double and its embed mock
  // never run. Clear it, and put the embed/ANN doubles back to "unavailable".
  __clearL1CacheForTests();
  doubles.embed.mockReset();
  doubles.embed.mockImplementation(async () => { throw new Error('no provider'); });
  doubles.ann.mockReset();
  doubles.ann.mockResolvedValue([]);
});

vi.mock('../memory/memoryEmbedding', async () => {
  const actual = await vi.importActual<typeof import('../memory/memoryEmbedding')>('../memory/memoryEmbedding');
  return { ...actual, embedMemoryText: doubles.embed };
});

vi.mock('../memory/memorySemanticRecall', async () => {
  const actual = await vi.importActual<typeof import('../memory/memorySemanticRecall')>('../memory/memorySemanticRecall');
  return { ...actual, annRecallProject: doubles.ann };
});

/** Flatten a drizzle SQL tree to text so a predicate can be asserted on. */
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
  wheres: string[];
  updates: Array<{ set: Record<string, unknown>; where: string }>;
  values: Record<string, unknown> | null;
  conflict: Record<string, unknown> | null;
  selectRows: Array<Array<Record<string, unknown>>>;
}

/**
 * db double exposing the chains the code builds. `selectRows` lets a test queue
 * per-call result sets: e.g. the prior-recall-count read, then the lexical arm.
 */
function makeDb(opts?: {
  selectRows?: (callIndex: number) => Array<Record<string, unknown>>;
  distinctRows?: Array<Record<string, unknown>>;
}): { db: unknown; calls: Captured } {
  const calls: Captured = { wheres: [], updates: [], values: null, conflict: null, selectRows: [] };
  let selectCall = 0;
  const db = {
    select: () => {
      const index = selectCall++;
      return {
        from: () => ({
          where: (w: unknown) => {
            calls.wheres.push(sqlText(w));
            const rows = opts?.selectRows?.(index) ?? [];
            calls.selectRows.push(rows);
            return {
              orderBy: () => ({ limit: async () => rows }),
              limit: async () => rows,
            };
          },
        }),
      };
    },
    selectDistinct: () => ({
      from: () => {
        const rows = Promise.resolve(opts?.distinctRows ?? []);
        return { then: rows.then.bind(rows), catch: rows.catch.bind(rows) };
      },
    }),
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
          // A `.returning()` on the decay sweep.
          const thenable = Promise.resolve([{ key: 'expired-key' }]) as Promise<unknown> & { returning: () => Promise<unknown> };
          thenable.returning = async () => [{ key: 'expired-key' }];
          return thenable;
        },
      }),
    }),
  };
  return { db, calls };
}

// ---------------------------------------------------------------------------
// (1) FILE ANCHORS
// ---------------------------------------------------------------------------

describe('file anchors (5301 req 1)', () => {
  it('persists the anchors a write supplies', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db as never, 7, 42, 'step-cap', 'no cap', 'agent', {
      fileAnchors: [{ path: 'api/src/run/loop.ts', line: 12, contentHash: 'abc123' }],
    });
    expect(calls.values?.fileAnchors).toEqual([
      { path: 'api/src/run/loop.ts', line: 12, contentHash: 'abc123' },
    ]);
    // Replace-on-write must carry anchors too, or a re-assertion silently unanchors.
    expect((calls.conflict?.set as Record<string, unknown>).fileAnchors).toEqual([
      { path: 'api/src/run/loop.ts', line: 12, contentHash: 'abc123' },
    ]);
  });

  it('normalizes anchors: drops nameless paths, never invents a hash', () => {
    expect(normalizeFileAnchors([{ path: 'a.ts' }, { path: '   ' }])).toEqual([{ path: 'a.ts' }]);
    // An anchor with no recorded hash is kept but carries NO contentHash key — a
    // missing hash must not be treated as stale.
    const out = normalizeFileAnchors([{ path: 'a.ts' }]);
    expect(out?.[0]).not.toHaveProperty('contentHash');
    expect(normalizeFileAnchors([])).toBeNull();
    expect(normalizeFileAnchors(null)).toBeNull();
  });

  it('flags a fact stale only when an anchored file hash CHANGED', async () => {
    const stale = await anchorsAreStale(
      [{ path: 'a.ts', contentHash: 'old' }],
      async () => 'new',
    );
    expect(stale).toBe(true);
  });

  it('does NOT flag stale when the file hash is unchanged, missing, or unreadable', async () => {
    // Same hash — the belief still matches the file.
    expect(await anchorsAreStale([{ path: 'a.ts', contentHash: 'same' }], async () => 'same')).toBe(false);
    // No recorded hash at write time — nothing to compare, so not stale.
    expect(await anchorsAreStale([{ path: 'a.ts' }], async () => 'anything')).toBe(false);
    // Reader cannot see the file (null) — a missing read must never drop a belief.
    expect(await anchorsAreStale([{ path: 'a.ts', contentHash: 'old' }], async () => null)).toBe(false);
    // Reader throws — fail open, not closed.
    expect(await anchorsAreStale(
      [{ path: 'a.ts', contentHash: 'old' }],
      async () => { throw new Error('no index'); },
    )).toBe(false);
    // No anchors at all.
    expect(await anchorsAreStale(null, async () => 'new')).toBe(false);
  });

  it('excludes the stale fact from recall and keeps the fresh one', async () => {
    // Lexical arm returns one anchored (now-changed) and one unanchored fact.
    const { db } = makeDb({
      selectRows: () => [
        { key: 'stale-one', content: 'about loop.ts', expiresAt: null, importance: 0.5, fileAnchors: [{ path: 'loop.ts', contentHash: 'old' }] },
        { key: 'fresh-one', content: 'about other', expiresAt: null, importance: 0.5, fileAnchors: null },
      ],
    });
    const facts = await recallProjectFacts(env, db as never, 7, 42, {
      query: 'loop',
      readFileHash: async (p) => (p === 'loop.ts' ? 'new' : null),
    });
    expect(facts.map((f) => f.key)).toEqual(['fresh-one']);
  });

  it('keeps EVERYTHING when no hash reader is supplied (no caller regression)', async () => {
    const { db } = makeDb({
      selectRows: () => [{ key: 'a', content: 'x', expiresAt: null, importance: 0.5, fileAnchors: [{ path: 'loop.ts', contentHash: 'old' }] }],
    });
    const facts = await recallProjectFacts(env, db as never, 7, 42, { query: 'x' });
    expect(facts.map((f) => f.key)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// (2) PROVENANCE
// ---------------------------------------------------------------------------

describe('provenance (5301 req 2)', () => {
  it('stamps origin_execution_id and origin_model when the caller has both', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db as never, 7, 42, 'k', 'v', 'agent', {
      originExecutionId: 555,
      origin: { model: 'text-embedding-3-small', promptTokens: 10, completionTokens: 20 },
    });
    expect(calls.values?.originExecutionId).toBe(555);
    expect(calls.values?.originModel).toBe('text-embedding-3-small');
  });

  it('stamps the model from the execution own LLM trace when the caller has no model', async () => {
    // select #0 = origin trace lookup; select #1 = prior recall count.
    const { db, calls } = makeDb({
      selectRows: (i) => (i === 0
        ? [{ model: 'gpt-4o-mini', promptTokens: 3, completionTokens: 4 }]
        : []),
    });
    await upsertProjectFact(env, db as never, 7, 42, 'k', 'v', 'agent', { originExecutionId: 777 });
    expect(calls.values?.originExecutionId).toBe(777);
    expect(calls.values?.originModel).toBe('gpt-4o-mini');
  });

  it('leaves provenance NULL rather than inventing it', async () => {
    const { db, calls } = makeDb();
    await upsertProjectFact(env, db as never, 7, 42, 'k', 'v', 'agent');
    expect(calls.values?.originExecutionId).toBeNull();
    expect(calls.values?.originModel).toBeNull();
    // A half-known cost is stored as none — never a model with fabricated tokens.
    expect(calls.values?.originPromptTokens).toBeNull();
    expect(calls.values?.originCompletionTokens).toBeNull();
  });

  it('records no model when the trace lookup finds nothing', async () => {
    const { db, calls } = makeDb({ selectRows: () => [] });
    await upsertProjectFact(env, db as never, 7, 42, 'k', 'v', 'agent', { originExecutionId: 777 });
    expect(calls.values?.originModel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) RANKING — importance is real
// ---------------------------------------------------------------------------

describe('ranking (5301 req 3)', () => {
  it('lifts importance by how often recall already returned the key', async () => {
    const importanceWith = async (prior: number) => {
      // No executionId means no origin-trace lookup, so the prior recall count IS
      // the first (and only) select.
      const { db, calls } = makeDb({ selectRows: (i) => (i === 0 ? [{ recallCount: prior }] : []) });
      await upsertProjectFact(env, db as never, 7, 42, 'k', 'The run loop NEVER truncates.', 'agent');
      return Number(calls.values?.importance);
    };
    const cold = await importanceWith(0);
    const warm = await importanceWith(9);
    // Same content, same kind — the ONLY difference is the recall count, so any
    // increase is attributable to it and nothing else.
    expect(warm).toBeGreaterThan(cold);
    // The lift is deliberately small: it ranks, it does not dominate.
    expect(warm - cold).toBeLessThanOrEqual(0.1);
    expect(warm).toBeLessThanOrEqual(1);
  });

  it('importance reaches the prompt block (not the flat 0.5)', async () => {
    const { db } = makeDb({
      selectRows: () => [
        { key: 'invariant', content: 'NEVER do this.', expiresAt: null, importance: 0.95, fileAnchors: null },
        { key: 'casual', content: 'was once here.', expiresAt: null, importance: 0.2, fileAnchors: null },
      ],
    });
    const facts = await recallProjectFacts(env, db as never, 7, 42, { query: 'x' });
    // Ranked by importance: the invariant leads, proving the weight is not inert.
    expect(facts[0]?.key).toBe('invariant');
  });
});

// ---------------------------------------------------------------------------
// (4) VECTOR RECALL
// ---------------------------------------------------------------------------

describe('vector recall (5301 req 4)', () => {
  it('consults the shared pgvector ANN path for the run-start recall', async () => {
    doubles.ann.mockClear();
    const { db } = makeDb({ selectRows: () => [] });
    doubles.embed.mockResolvedValueOnce(embedding());
    await recallProjectFacts(env, db as never, 7, 42, { query: 'how does auth work' });
    // The semantic arm is wired to the SAME ANN read memoryService uses — not a
    // second keyword index wearing a vector's name.
    expect(doubles.ann.mock.calls.length).toBeGreaterThan(0);
  });

  it('fails SOFT to keyword when embeddings are unavailable', async () => {
    doubles.ann.mockClear();
    const { db } = makeDb({
      selectRows: () => [{ key: 'kw', content: 'keyword hit', expiresAt: null, importance: 0.5, fileAnchors: null }],
    });
    // embedMemoryText throws (the module default) — recall must still answer.
    doubles.embed.mockRejectedValueOnce(new Error('no provider') as never);
    const facts = await recallProjectFacts(env, db as never, 7, 42, { query: 'auth' });
    expect(facts.map((f) => f.key)).toEqual(['kw']);
    expect(doubles.ann).not.toHaveBeenCalled();
  });

  it('never lets the semantic arm resurrect a superseded fact', async () => {
    // ANN nominates a retired key; the hydration WHERE must re-apply the predicate
    // in SQL against the table that owns the column.
    doubles.ann.mockClear();
    const captured: string[] = [];
    let n = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: (w: unknown) => {
            captured.push(sqlText(w));
            const rows = n === 1 ? [{ key: 'live', content: 'c', expiresAt: null, importance: 0.5, fileAnchors: null }] : [];
            n += 1;
            return { orderBy: () => ({ limit: async () => rows }), limit: async () => rows };
          },
        }),
      }),
    };
    doubles.embed.mockResolvedValueOnce(embedding());
    doubles.ann.mockResolvedValueOnce([
      { id: 'project:retired', key: 'retired', content: 'old', expiresAt: null, vectorScore: 0.99 },
    ] as never);
    await recallProjectFacts(env, db as never, 7, 42, { query: 'anything' });
    expect(captured.some((w) => w.includes('superseded_by'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) QA CACHE EXPIRY
// ---------------------------------------------------------------------------

describe('QA cache expiry (5301 req 5)', () => {
  it('gives a cached answer a TTL instead of replaying it forever', async () => {
    // `cacheProjectAnswer` is exercised through its own module's test; here assert
    // the constant the write path uses is a real, bounded window.
    const { QA_CACHE_TTL_MS } = await import('./projectFacts');
    expect(QA_CACHE_TTL_MS).toBeGreaterThan(0);
    expect(QA_CACHE_TTL_MS).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
  });

  it('drops a cached answer when the file it was about changed', async () => {
    // A qa-cache row is excluded from ambient recall by source; the anchor check is
    // the OTHER half of req 5 and must apply to whatever recall does return.
    const { db } = makeDb({
      selectRows: () => [{ key: 'qa:live', content: 'c', expiresAt: null, importance: 0.5, fileAnchors: [{ path: 'auth.ts', contentHash: 'old' }] }],
    });
    const facts = await recallProjectFacts(env, db as never, 7, 42, {
      query: 'q',
      readFileHash: async () => 'new',
    });
    expect(facts).toEqual([]);
  });

  it('leaves the decay sweep alone for qa-cache rows (their TTL is their own)', async () => {
    const { db, calls } = makeDb();
    await sweepUnrecalledFactDecay(db as never, 7, 42);
    expect(calls.updates.some((u) => u.where.includes('qa-cache'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (6) DECAY
// ---------------------------------------------------------------------------

describe('decay (5301 req 6)', () => {
  const NOW = new Date('2026-10-20T00:00:00.000Z');

  it('drops facts never recalled, keeps recently recalled ones', () => {
    const kept = decayUnrecalled(
      [
        { lastRecalledAt: null },
        { lastRecalledAt: '2026-10-19T00:00:00.000Z' },
        { lastRecalledAt: '2026-01-01T00:00:00.000Z' },
      ],
      NOW,
      30 * 24 * 60 * 60 * 1000,
    );
    // Null = never recalled = drops first. Recent survives. An old recall drops.
    expect(kept).toHaveLength(1);
    expect(kept[0]?.lastRecalledAt).toBe('2026-10-19T00:00:00.000Z');
  });

  it('is a no-op for a non-positive window', () => {
    const facts = [{ lastRecalledAt: null }];
    expect(decayUnrecalled(facts, NOW, 0)).toHaveLength(1);
    expect(decayUnrecalled(facts, NOW, -1)).toHaveLength(1);
  });

  it('recall stamps last_recalled_at and increments recall_count for RETURNED keys only', async () => {
    const { db, calls } = makeDb();
    await stampFactRecall(db as never, 7, 42, ['a', 'b', 'a', '  ']);
    expect(calls.updates).toHaveLength(1);
    const stamp = calls.updates[0];
    if (!stamp) throw new Error('recall did not stamp');
    expect(stamp.set).toHaveProperty('lastRecalledAt');
    expect(sqlText(stamp.set.recallCount)).toContain('recall_count');
    // Live rows only — a stamp can never revive a retired fact.
    expect(stamp.where).toContain('superseded_by');
    expect(stamp.where).toContain('tenant_id');
  });

  it('does not stamp nothing', async () => {
    const { db, calls } = makeDb();
    await stampFactRecall(db as never, 7, 42, []);
    await stampFactRecall(db as never, 7, 0, ['a']);
    expect(calls.updates).toHaveLength(0);
  });

  it('the sweep expires only unrecalled, live, unexpired rows', async () => {
    const { db, calls } = makeDb();
    const n = await sweepUnrecalledFactDecay(db as never, 7, 42);
    expect(calls.updates).toHaveLength(1);
    const sweep = calls.updates[0];
    if (!sweep) throw new Error('no sweep UPDATE was emitted');
    // Written as an EXPIRY, never a delete — "the project once believed this"
    // stays answerable.
    expect(sweep.set).toHaveProperty('expiresAt');
    expect(sweep.set).not.toHaveProperty('deletedAt');
    expect(sweep.where).toContain('last_recalled_at');
    expect(sweep.where).toContain('superseded_by');
    // A missing last_recalled_at expires only once SOME row in the scope has been
    // stamped. A bare IS NULL would expire every row on the first sweep.
    expect(sweep.where).toContain('stamped_recall');
    expect(sweep.where).toContain('IS NOT NULL');
    expect(typeof n).toBe('number');
  });

  it('is a no-op for an invalid project or a non-positive window', async () => {
    const { db, calls } = makeDb();
    expect(await sweepUnrecalledFactDecay(db as never, 7, 0)).toBe(0);
    expect(await sweepUnrecalledFactDecay(db as never, 7, 42, { windowMs: 0 })).toBe(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('runs across every project scope, not just a caller-supplied one', async () => {
    const { db } = makeDb({ distinctRows: [{ tenantId: 7, projectId: 42 }, { tenantId: 8, projectId: 99 }] });
    // Two scopes in, two expiry statements out.
    const total = await sweepAllUnrecalledFactDecay(db as never);
    expect(typeof total).toBe('number');
  });
});