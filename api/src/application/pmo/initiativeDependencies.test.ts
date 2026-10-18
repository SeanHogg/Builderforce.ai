/**
 * PMO initiative edges — the write the route used to do inline. Pins the refusals
 * the route answered, plus the race close adopted from task precedence edges.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { addInitiativeDependency, deleteInitiativeDependency } from './initiativeDependencies';

const scope = { tenantId: 7, segmentId: 'seg-1' };
const both = [{ id: 'A' }, { id: 'B' }];

describe('addInitiativeDependency', () => {
  it('requires both ends and refuses a self-dependency without a query', async () => {
    const db = fakeDb();
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', null)).toMatchObject({ ok: false, status: 400 });
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', 'A')).toMatchObject({ ok: false, status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  it('404s when either initiative is outside the tenant/segment', async () => {
    const db = fakeDb([[{ id: 'A' }]]);
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', 'B')).toMatchObject({ ok: false, status: 404 });
  });

  it('409s on an edge that would close a cycle, before inserting', async () => {
    const db = fakeDb([both, [{ fromInitiativeId: 'B', toInitiativeId: 'A' }]]);
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', 'B')).toMatchObject({ ok: false, status: 409 });
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('inserts an acyclic edge in the caller\'s segment', async () => {
    const edge = { id: 'd-1', fromInitiativeId: 'A', toInitiativeId: 'B' };
    const db = fakeDb([both, [], [edge], [{ fromInitiativeId: 'A', toInitiativeId: 'B' }]]);
    const res = await addInitiativeDependency(db as unknown as Db, scope, 'A', 'B');
    expect(res).toEqual({ ok: true, edge });
    expect(db.calls[2]?.payload).toEqual({ tenantId: 7, segmentId: 'seg-1', fromInitiativeId: 'A', toInitiativeId: 'B' });
  });

  it('compensates when a concurrent reverse edge landed between check and insert', async () => {
    const db = fakeDb([
      both,
      [],                                    // pre-check: no edges yet
      [{ id: 'd-1' }],                       // our insert
      [{ fromInitiativeId: 'A', toInitiativeId: 'B' }, { fromInitiativeId: 'B', toInitiativeId: 'A' }],
      [],                                    // compensating delete
    ]);
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', 'B')).toMatchObject({ ok: false, status: 409 });
    expect(db.calls.at(-1)?.kind).toBe('delete');
  });

  it('treats an existing identical edge as success', async () => {
    const db = fakeDb([both, [], []]);
    expect(await addInitiativeDependency(db as unknown as Db, scope, 'A', 'B'))
      .toEqual({ ok: true, edge: { fromInitiativeId: 'A', toInitiativeId: 'B' } });
  });
});

describe('deleteInitiativeDependency', () => {
  it('returns the deleted id, or null when nothing in scope matched', async () => {
    expect(await deleteInitiativeDependency(fakeDb([[{ id: 'd-1' }]]) as unknown as Db, scope, 'd-1')).toBe('d-1');
    expect(await deleteInitiativeDependency(fakeDb([[]]) as unknown as Db, scope, 'd-x')).toBeNull();
  });
});
