/**
 * The outbound queue, as tests.
 *
 * `board_sync_outbox` had a drain, a retry policy, a dead-letter and a cron sweep
 * — and no writer at all, so every "bidirectional sync" claim was one-directional
 * in fact. These cover the two behaviours that decide whether filling it is safe:
 * a task with no external link must enqueue nothing, and a burst of changes on one
 * ticket must MERGE rather than pile up four PUTs against a help desk.
 */
import { describe, expect, it } from 'vitest';
import { enqueueBoardPush } from './outbound';
import type { Db } from '../../infrastructure/database/connection';

type Call = { kind: 'insert' | 'update'; values?: Record<string, unknown> };

/** A db just wide enough for this module: two selects, then inserts/updates. */
function fakeDb(links: Array<{ connectionId: string }>, pending: Array<{ id: string; connectionId: string; changeSet: string | null }>) {
  const calls: Call[] = [];
  let select = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: (..._a: unknown[]) => {
          const rows = select++ === 0 ? links : pending;
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        calls.push({ kind: 'insert', values });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          calls.push({ kind: 'update', values });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as unknown as Db, calls };
}

describe('enqueueBoardPush', () => {
  it('enqueues one push per linked external ticket', async () => {
    const { db, calls } = fakeDb([{ connectionId: 'c-1' }, { connectionId: 'c-2' }], []);

    const result = await enqueueBoardPush(db, { tenantId: 7, taskId: 42, changeSet: { state: 'resolved', severity: 'sev1' } });

    expect(result).toEqual({ queued: 2, merged: 0 });
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.values?.changeSet))).toEqual({ state: 'resolved', severity: 'sev1' });
  });

  it('enqueues nothing when the task is not linked to any external board', async () => {
    // Most workspaces have no external board at all. A push queued for nobody is
    // a row the drain dead-letters for want of an externalId.
    const { db, calls } = fakeDb([], []);
    expect(await enqueueBoardPush(db, { tenantId: 7, taskId: 42, changeSet: { state: 'resolved' } })).toEqual({ queued: 0, merged: 0 });
    expect(calls).toHaveLength(0);
  });

  it('merges into an undrained push instead of queueing a second one', async () => {
    // An incident walks open → acknowledged → mitigated → resolved in minutes.
    // Four PUTs is rate-limit bait and shows three states nobody needed to see.
    const { db, calls } = fakeDb(
      [{ connectionId: 'c-1' }],
      [{ id: 'o-1', connectionId: 'c-1', changeSet: JSON.stringify({ state: 'acknowledged', severity: 'sev2' }) }],
    );

    const result = await enqueueBoardPush(db, { tenantId: 7, taskId: 42, changeSet: { state: 'resolved' } });

    expect(result).toEqual({ queued: 1, merged: 1 });
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
    // Last-write-wins per field: the new state replaces, the untouched severity survives.
    expect(JSON.parse(String(calls[0]?.values?.changeSet))).toEqual({ state: 'resolved', severity: 'sev2' });
  });

  it('resets the backoff clock on a merge', async () => {
    // Inheriting a failed row's attempt count would delay a resolution notice by
    // however long the previous failure had earned.
    const { db, calls } = fakeDb([{ connectionId: 'c-1' }], [{ id: 'o-1', connectionId: 'c-1', changeSet: null }]);
    await enqueueBoardPush(db, { tenantId: 7, taskId: 42, changeSet: { state: 'resolved' } });
    expect(calls[0]?.values?.attempts).toBe(0);
    expect(calls[0]?.values?.lastError).toBeNull();
  });

  it('drops undefined fields rather than pushing them as nulls', async () => {
    // `{ state: undefined }` is "this did not change", and a provider handed it
    // would clear the field on the external ticket.
    const { db, calls } = fakeDb([{ connectionId: 'c-1' }], []);
    const result = await enqueueBoardPush(db, { tenantId: 7, taskId: 42, changeSet: { state: undefined, severity: undefined } });
    expect(result).toEqual({ queued: 0, merged: 0 });
    expect(calls).toHaveLength(0);
  });
});
