import { describe, expect, it } from 'vitest';
import { planPull, type PullChange, type PullPlan } from './pullPlan.js';

const DELETED_AT = '2026-10-19T12:00:00.000Z';
const LATER_DELETED_AT = '2026-10-19T13:00:00.000Z';

function change(
  partial: PullChange<{ title: string }> & { extra?: string },
): PullChange<{ title: string }> & { extra?: string } {
  return { ...partial };
}

function asApply(plan: PullPlan<{ title: string }>) {
  expect(plan.action).toBe('apply');
  if (plan.action !== 'apply') throw new Error('expected apply');
  return plan;
}

describe('planPull', () => {
  it('resnapshots a null cursor and does not merge the supplied changes', () => {
    const changes = [change({ clientEntityId: 'ticket-1', body: { title: 'secret' } })];
    const plan = planPull({ cursor: null, changes });

    expect(plan).toEqual({ action: 'resnapshot' });
    expect(plan).not.toHaveProperty('changes');
    expect(plan).not.toHaveProperty('entities');
    expect(plan).not.toHaveProperty('cursor');
    expect(plan).not.toHaveProperty('sequence');
    expect(JSON.stringify(plan)).not.toContain('secret');
    expect(JSON.stringify(plan)).not.toContain('0');
    expect(changes).toEqual([{ clientEntityId: 'ticket-1', body: { title: 'secret' } }]);
  });

  it('resnapshots a blank cursor instead of treating it as sequence 0', () => {
    const changes = [change({ clientEntityId: 'ticket-1', body: { title: 'kept' } })];
    for (const cursor of ['', '   ', '\n\t']) {
      const plan = planPull({ cursor, changes });
      expect(plan).toEqual({ action: 'resnapshot' });
      expect(plan).not.toHaveProperty('sequence');
      expect(JSON.stringify(plan)).not.toContain('ticket-1');
    }
  });

  it('resnapshots when expired even if the cursor and changes are usable', () => {
    const changes = [change({ clientEntityId: 'ticket-1', body: { title: 'partial' } })];
    const plan = planPull({ cursor: 'cursor-9', changes, expired: true });

    expect(plan).toEqual({ action: 'resnapshot' });
    expect(Object.keys(plan)).toEqual(['action']);
    expect(JSON.stringify(plan)).not.toContain('partial');
    expect(JSON.stringify(plan)).not.toContain('cursor-9');
    expect(changes).toHaveLength(1);
  });

  it('does not turn a caller-rejected cursor into a merge that starts at sequence 0', () => {
    const undecoded = planPull({
      cursor: null,
      changes: [change({ clientEntityId: 'ticket-1', body: { title: 'nope' } })],
    });
    expect(undecoded).toEqual({ action: 'resnapshot' });
    expect(undecoded).not.toHaveProperty('sequence');

    const passedThrough = planPull({ cursor: '0', changes: [] });
    expect(passedThrough).not.toHaveProperty('sequence');
    const applied = asApply(passedThrough);
    expect(applied.cursor).toBe('0');
    expect(typeof applied.cursor).toBe('string');
    expect(applied.changes).toEqual([]);
    expect(applied.entities).toEqual([]);
  });

  it('applies a usable cursor without dropping or reordering rows', () => {
    const changes = [
      change({ clientEntityId: 'a', body: { title: 'first' }, extra: 'keep' }),
      change({ clientEntityId: 'a', body: { title: 'second' } }),
      change({ clientEntityId: 'b', body: { title: 'other' } }),
    ];
    const plan = asApply(planPull({ cursor: 'cursor-1', changes, expired: false }));

    expect(plan.cursor).toBe('cursor-1');
    expect(plan.changes).toHaveLength(3);
    expect(plan.changes.map((row) => row.clientEntityId)).toEqual(['a', 'a', 'b']);
    expect(plan.changes[0]).toMatchObject({ extra: 'keep', body: { title: 'first' } });
    expect(plan.changes).not.toBe(changes);
    expect(plan.changes[0]).not.toBe(changes[0]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.changes)).toBe(true);
    expect(Object.isFrozen(changes)).toBe(false);
  });

  it('marks a non-blank deletedAt as a tombstone and does not keep its body', () => {
    const changes = [
      change({
        clientEntityId: 'ticket-1',
        deletedAt: DELETED_AT,
        body: { title: 'gone' },
        payload: { title: 'also gone' },
      }),
    ];
    const plan = asApply(planPull({ cursor: 'cursor-2', changes }));

    expect(plan.changes).toEqual([{ clientEntityId: 'ticket-1', deletedAt: DELETED_AT }]);
    expect(plan.changes[0]).not.toHaveProperty('body');
    expect(plan.changes[0]).not.toHaveProperty('payload');
    expect(plan.entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'delete', deletedAt: DELETED_AT },
    ]);
    expect(plan.entities[0]).not.toHaveProperty('body');
    expect(plan.entities[0]).not.toHaveProperty('payload');
    expect(changes[0].body).toEqual({ title: 'gone' });
    expect(changes[0].payload).toEqual({ title: 'also gone' });
  });

  it('treats a missing or blank deletedAt as an upsert and keeps the body', () => {
    const missing = asApply(
      planPull({
        cursor: 'cursor-3',
        changes: [change({ clientEntityId: 'ticket-1', body: { title: 'live' } })],
      }),
    );
    const blank = asApply(
      planPull({
        cursor: 'cursor-3',
        changes: [change({ clientEntityId: 'ticket-2', deletedAt: '   ', body: { title: 'still' } })],
      }),
    );
    const explicitNull = asApply(
      planPull({
        cursor: 'cursor-3',
        changes: [change({ clientEntityId: 'ticket-3', deletedAt: null, body: { title: 'null' } })],
      }),
    );

    expect(missing.entities).toEqual([{ clientEntityId: 'ticket-1', op: 'upsert', body: { title: 'live' } }]);
    expect(blank.entities).toEqual([{ clientEntityId: 'ticket-2', op: 'upsert', body: { title: 'still' } }]);
    expect(explicitNull.entities[0]).toMatchObject({ op: 'upsert', body: { title: 'null' } });
    expect(blank.changes[0]).toHaveProperty('body');
  });

  it('lets a later row for the same clientEntityId win without dropping earlier rows', () => {
    const upsertThenDelete = [
      change({ clientEntityId: 'ticket-1', body: { title: 'live' } }),
      change({ clientEntityId: 'ticket-1', deletedAt: DELETED_AT, body: { title: 'live' } }),
    ];
    const deleteThenUpsert = [
      change({ clientEntityId: 'ticket-1', deletedAt: DELETED_AT, body: { title: 'old' } }),
      change({ clientEntityId: 'ticket-1', body: { title: 'restored' } }),
    ];
    const twoDeletes = [
      change({ clientEntityId: 'ticket-1', deletedAt: DELETED_AT, body: { title: 'old' } }),
      change({ clientEntityId: 'ticket-1', deletedAt: LATER_DELETED_AT, body: { title: 'newer' } }),
    ];
    const twoUpserts = [
      change({ clientEntityId: 'ticket-1', body: { title: 'old' } }),
      change({ clientEntityId: 'ticket-1', body: { title: 'new' } }),
    ];

    const deleted = asApply(planPull({ cursor: 'c', changes: upsertThenDelete }));
    expect(deleted.changes).toHaveLength(2);
    expect(deleted.entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'delete', deletedAt: DELETED_AT },
    ]);

    const restored = asApply(planPull({ cursor: 'c', changes: deleteThenUpsert }));
    expect(restored.changes).toHaveLength(2);
    expect(restored.changes[0]).not.toHaveProperty('body');
    expect(restored.entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'upsert', body: { title: 'restored' } },
    ]);

    expect(asApply(planPull({ cursor: 'c', changes: twoDeletes })).entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'delete', deletedAt: LATER_DELETED_AT },
    ]);
    expect(asApply(planPull({ cursor: 'c', changes: twoUpserts })).entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'upsert', body: { title: 'new' } },
    ]);
  });

  it('orders collapsed entities by the winning row and keeps unrelated rows', () => {
    const changes = [
      change({ clientEntityId: 'a', body: { title: 'a1' } }),
      change({ clientEntityId: 'b', body: { title: 'b' } }),
      change({ clientEntityId: 'a', deletedAt: DELETED_AT, body: { title: 'a1' } }),
    ];
    const plan = asApply(planPull({ cursor: 'cursor-4', changes }));

    expect(plan.changes).toHaveLength(3);
    expect(plan.entities).toEqual([
      { clientEntityId: 'b', op: 'upsert', body: { title: 'b' } },
      { clientEntityId: 'a', op: 'delete', deletedAt: DELETED_AT },
    ]);
  });

  it('does not mutate the input array or its change objects', () => {
    const row = change({ clientEntityId: 'ticket-1', deletedAt: DELETED_AT, body: { title: 'kept on input' } });
    const changes = [row];
    const plan = asApply(planPull({ cursor: 'cursor-5', changes }));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(row);
    expect(row.body).toEqual({ title: 'kept on input' });
    expect(plan.changes[0]).not.toBe(row);
    changes.push(change({ clientEntityId: 'ticket-2', body: { title: 'later' } }));
    expect(plan.changes).toHaveLength(1);
    expect(() => {
      (plan.changes as PullChange<{ title: string }>[]).push(
        change({ clientEntityId: 'ticket-3', body: { title: 'nope' } }),
      );
    }).toThrow();
  });

  it('copies an upsert body so editing the plan does not edit the input', () => {
    const row = change({ clientEntityId: 'ticket-1', body: { title: 'original' } });
    const plan = asApply(planPull({ cursor: 'cursor-6', changes: [row] }));
    const planned = plan.entities[0];
    if (planned.op !== 'upsert' || !planned.body) throw new Error('expected upsert body');
    planned.body.title = 'edited';
    expect(row.body).toEqual({ title: 'original' });
  });

  it('keeps a row that has no clientEntityId in changes and does not invent an entity', () => {
    const changes = [
      change({ clientEntityId: '', body: { title: 'anonymous' } }),
      change({ clientEntityId: 'ticket-1', body: { title: 'named' } }),
    ];
    const plan = asApply(planPull({ cursor: 'cursor-7', changes }));

    expect(plan.changes).toHaveLength(2);
    expect(plan.entities).toEqual([{ clientEntityId: 'ticket-1', op: 'upsert', body: { title: 'named' } }]);
  });

  it('applies an empty change list without resnapshotting a usable cursor', () => {
    const plan = asApply(planPull({ cursor: 'cursor-8' }));
    expect(plan.changes).toEqual([]);
    expect(plan.entities).toEqual([]);
  });

  it('uses payload as the upsert body when body is absent', () => {
    const plan = asApply(
      planPull({
        cursor: 'cursor-9',
        changes: [change({ clientEntityId: 'ticket-1', payload: { title: 'from payload' } })],
      }),
    );
    expect(plan.entities).toEqual([
      { clientEntityId: 'ticket-1', op: 'upsert', body: { title: 'from payload' } },
    ]);
  });
});
