import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const signal = vi.fn();
vi.mock('./journeySignal', () => ({ journeySignal: (...args: unknown[]) => signal(...args) }));

import { founderJourneySummary } from './founderJourneySummary';

/**
 * The founder-journey summary: single-row / existence reads in place of three full
 * lists, and the session's proof read only when it can decide the answer.
 */

/** A `Db` double answering each `select()` with the next queued result, in call order. */
function fakeDb(results: unknown[][]) {
  const calls: number[] = [];
  const db = {
    select: () => {
      const rows = results[calls.length] ?? [];
      calls.push(calls.length);
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
  } as unknown as Db;
  return { db, selects: () => calls.length };
}

const env = {} as Env;
let n = 0;
const scope = () => ({ tenantId: 1, segmentId: 'seg', userId: `u${(n += 1)}` });

describe('founderJourneySummary', () => {
  it('reads the session proof when nothing outranks it', async () => {
    signal.mockResolvedValueOnce({ stage: null, realizationId: null });
    // companies → none; sessions → one; proof → met
    const { db, selects } = fakeDb([[], [{ id: 's1' }], [{ verdict: 'met' }]]);
    expect(await founderJourneySummary(env, db, scope())).toEqual({
      ownsCompany: false,
      signal: { stage: null, realizationId: null },
      activeSessionId: 's1',
      activeSessionLatestProof: { verdict: 'met' },
    });
    expect(selects()).toBe(3);
  });

  it('skips the proof read when a company already decides the stage', async () => {
    signal.mockResolvedValueOnce({ stage: null, realizationId: null });
    const { db, selects } = fakeDb([[{ id: 9 }], [{ id: 's1' }]]);
    const summary = await founderJourneySummary(env, db, scope());
    expect(summary.ownsCompany).toBe(true);
    expect(summary.activeSessionLatestProof).toBeNull();
    expect(selects()).toBe(2);
  });

  it('a failed signal degrades to no signal instead of failing the summary', async () => {
    signal.mockRejectedValueOnce(new Error('kv down'));
    const { db } = fakeDb([[], [{ id: 's1' }], []]);
    expect(await founderJourneySummary(env, db, scope())).toMatchObject({
      signal: { stage: null, realizationId: null }, activeSessionId: 's1', activeSessionLatestProof: null,
    });
  });

  it('reports no session and no proof for a brand-new workspace', async () => {
    signal.mockResolvedValueOnce({ stage: null, realizationId: null });
    const { db } = fakeDb([[], []]);
    expect(await founderJourneySummary(env, db, scope())).toMatchObject({ ownsCompany: false, activeSessionId: null, activeSessionLatestProof: null });
  });
});
