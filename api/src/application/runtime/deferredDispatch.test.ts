/**
 * Parking a deferred one-shot dispatch: the queue row is the `deferred_dispatches` upsert; the `dispatch.deferred`
 * audit event beside it is a timeline note only. (The queue behaviour itself - claim, backoff, abandon - is proved
 * against real Postgres in `deferredDispatchSweep.pglite.test.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const recordCloudToolEvent = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(...a) }));
const reportCaughtError = vi.fn();
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: (...a: unknown[]) => reportCaughtError(...a) }));

const onSuperseded = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./deferredDispatchHandlers', () => ({
  DEFERRED_DISPATCH_HANDLERS: {
    ci_autofix: { onSuperseded: (...a: unknown[]) => onSuperseded(...a), supersedeKey: (m: Record<string, unknown>) => String(m.sha ?? '') },
    // No `supersedeKey`: the key-sorted comparison of the whole meta decides.
    validation: { onSuperseded: (...a: unknown[]) => onSuperseded(...a) },
    security: {}, incident: {},
  },
}));

import { DEFERRED_DISPATCH_EVENT, isDeferredDispatchKind, parkDeferredDispatch } from './deferredDispatch';

/** A db whose `insert().values().onConflictDoUpdate()` records the row and resolves (or rejects); `older` is the pending row it already holds. */
function fakeDb(failure?: Error, older?: { dispatchPayload: string | null; meta: Record<string, unknown> }, claimed: boolean | number = false, transactional = false) {
  const seen: { values?: Record<string, unknown>; conflict?: { set: Record<string, unknown> }; order: string[] } = { order: [] };
  const handle = {
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => {
      seen.order.push('select');
      return older ? [{ payload: older, claimedAt: claimed ? new Date(Date.now() - (typeof claimed === 'number' ? claimed : 0)) : null }] : [];
    } }) }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        seen.values = v;
        return { onConflictDoUpdate: async (c: { set: Record<string, unknown> }) => { seen.order.push('insert'); seen.conflict = c; if (failure) throw failure; } };
      },
    }),
    execute: async () => { seen.order.push('lock'); },
  };
  // With `transactional`, the locked transaction path runs; without it `inTransaction` rejects and the unlocked fallback runs.
  const db = (transactional ? { ...handle, transaction: async (work: (tx: unknown) => Promise<unknown>) => work(handle) } : handle) as unknown as Db;
  return { db, seen };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('parkDeferredDispatch', () => {
  it('upserts the dispatch params (payload and meta together) and leaves created_at out of the conflict update', async () => {
    const { db, seen } = fakeDb();
    await parkDeferredDispatch(db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 'system:autofix', payload: '{"a":1}', agentHostId: 3, meta: { sha: 'x' } });
    expect(seen.values).toMatchObject({
      tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 'system:autofix', agentHostId: '3',
      payload: { dispatchPayload: '{"a":1}', meta: { sha: 'x' } },
    });
    expect(Object.keys(seen.conflict!.set)).not.toContain('createdAt');
    // A re-park clears the claim so a sweep dispatching the old payload is fenced out.
    expect(seen.conflict!.set).toHaveProperty('claimedAt', null);
  });

  it('regression: the TRANSACTION path takes the advisory lock, then reads the old row, then upserts; the fallback path reports and skips the lock', async () => {
    const locked = fakeDb(undefined, undefined, false, true);
    await parkDeferredDispatch(locked.db, { tenantId: 7, taskId: 42, kind: 'security', submittedBy: 's' });
    expect(locked.seen.order).toEqual(['lock', 'select', 'insert']);
    expect(reportCaughtError).not.toHaveBeenCalled();
    const unlocked = fakeDb();
    await parkDeferredDispatch(unlocked.db, { tenantId: 7, taskId: 42, kind: 'security', submittedBy: 's' });
    expect(unlocked.seen.order).toEqual(['select', 'insert']);
    expect(reportCaughtError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: 'parkDeferredDispatch:lock', level: 'warning' }));
  });

  it('the incoming meta is normalised the way jsonb stores it (undefined keys dropped, Dates as ISO strings)', async () => {
    const { db, seen } = fakeDb();
    await parkDeferredDispatch(db, { tenantId: 7, taskId: 42, kind: 'security', submittedBy: 's', meta: { a: undefined, d: new Date('2026-01-01T00:00:00Z'), n: 1 } });
    expect((seen.values as { payload: { meta: unknown } }).payload.meta).toEqual({ d: '2026-01-01T00:00:00.000Z', n: 1 });
  });

  it('a claim older than the lease is a dead tick\'s, not a dispatch in flight: the older row IS superseded', async () => {
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { sha: 'old' } }, 10 * 60_000).db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'new' } });
    expect(onSuperseded).toHaveBeenCalledTimes(1);
  });

  it('regression: Minor 3 - replacing a pending ci_autofix row with a DIFFERENT build records the older one as superseded', async () => {
    const { db } = fakeDb(undefined, { dispatchPayload: null, meta: { sha: 'old' } });
    await parkDeferredDispatch(db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'new' } });
    expect(onSuperseded).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, taskId: 42, payload: { dispatchPayload: null, meta: { sha: 'old' } } }), db);
  });

  it('regression: re-parking the SAME build (same sha, other attempt/key order) is not a supersede; with no supersedeKey a re-ordered identical meta is not one either', async () => {
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { attempt: 1, sha: 'x' } }).db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'x', attempt: 2 } });
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { a: 1, b: { c: 2, d: 3 } } }).db, { tenantId: 7, taskId: 42, kind: 'validation', submittedBy: 's', meta: { b: { d: 3, c: 2 }, a: 1 } });
    expect(onSuperseded).not.toHaveBeenCalled();
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { a: 1 } }).db, { tenantId: 7, taskId: 42, kind: 'validation', submittedBy: 's', meta: { a: 2 } });
    expect(onSuperseded).toHaveBeenCalledTimes(1);
  });

  it('a pending row that was CLAIMED (being dispatched) is not superseded', async () => {
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { sha: 'old' } }, true).db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'new' } });
    expect(onSuperseded).not.toHaveBeenCalled();
  });

  it('nothing is recorded as superseded when the upsert fails', async () => {
    await parkDeferredDispatch(fakeDb(new Error('db down'), { dispatchPayload: null, meta: { sha: 'old' } }).db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'new' } });
    expect(onSuperseded).not.toHaveBeenCalled();
  });

  it('re-parking the SAME event, a first deferral, or a kind with no hook records nothing', async () => {
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { sha: 'x' } }).db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'x' } });
    await parkDeferredDispatch(fakeDb().db, { tenantId: 7, taskId: 42, kind: 'ci_autofix', submittedBy: 's', meta: { sha: 'x' } });
    await parkDeferredDispatch(fakeDb(undefined, { dispatchPayload: null, meta: { auditId: 1 } }).db, { tenantId: 7, taskId: 42, kind: 'security', submittedBy: 's', meta: { auditId: 2 } });
    expect(onSuperseded).not.toHaveBeenCalled();
  });

  it('writes the informational timeline event after the row, never as the queue', async () => {
    const { db } = fakeDb();
    await parkDeferredDispatch(db, { tenantId: 7, taskId: 42, kind: 'security', submittedBy: 's' });
    expect(recordCloudToolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ tenantId: 7, toolName: DEFERRED_DISPATCH_EVENT, sessionKey: 'task:42' }));
  });

  it('reports a failed upsert without throwing, and writes no timeline note for a dispatch that was not parked', async () => {
    const { db } = fakeDb(new Error('db down'));
    await expect(parkDeferredDispatch(db, { tenantId: 7, taskId: 42, kind: 'incident', submittedBy: 's' })).resolves.toBeUndefined();
    expect(reportCaughtError).toHaveBeenCalled();
    expect(recordCloudToolEvent).not.toHaveBeenCalled();
  });
});

describe('isDeferredDispatchKind', () => {
  it('accepts the four one-shot dispatchers and nothing else', () => {
    for (const k of ['ci_autofix', 'incident', 'security', 'validation']) expect(isDeferredDispatchKind(k)).toBe(true);
    expect(isDeferredDispatchKind('lane')).toBe(false);
  });
});
