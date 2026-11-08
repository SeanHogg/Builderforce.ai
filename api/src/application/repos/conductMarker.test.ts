import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordManagerAction = vi.fn();
vi.mock('../manager/managerActionJournal', async () => ({
  ...(await vi.importActual<typeof import('../manager/managerActionJournal')>('../manager/managerActionJournal')),
  recordManagerAction: (...a: unknown[]) => recordManagerAction(...a),
}));
const readCronControls = vi.fn();
vi.mock('../runtime/cronControls', async () => {
  const actual = await vi.importActual<typeof import('../runtime/cronControls')>('../runtime/cronControls');
  return { ...actual, readCronControls: (...a: unknown[]) => readCronControls(...a) };
});

import {
  CONDUCT_DEFERRAL_WINDOW_MS, CONDUCT_MARKER_ACTION, CONDUCT_MARKER_REFRESH_MS,
  conductedRecently, loadConductMarkers, stampConducted,
} from './conductMarker';
import { loadSweepOwnedTickets } from './conductOwnership';
import { isConductedBySweep } from '../manager/triageStage';

const NOW = Date.parse('2026-11-08T12:00:00Z');

/** db whose single batched marker query resolves to `rows`; counts the queries issued. */
function markerDb(rows: Array<{ taskId: number; at: Date }>) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'groupBy']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain as never as { select: ReturnType<typeof vi.fn> };
}

beforeEach(() => { recordManagerAction.mockReset(); readCronControls.mockReset(); });

describe('conductedRecently / stampConducted', () => {
  it('trusts a marker only inside the deferral window', () => {
    const m = new Map([[1, new Date(NOW - CONDUCT_DEFERRAL_WINDOW_MS + 1)], [2, new Date(NOW - CONDUCT_DEFERRAL_WINDOW_MS - 1)]]);
    expect(conductedRecently(m, 1, NOW)).toBe(true);
    expect(conductedRecently(m, 2, NOW)).toBe(false);
    expect(conductedRecently(m, 3, NOW)).toBe(false);
  });

  it('writes a marker when none / a stale one exists, and not when it is fresh', async () => {
    const markers = new Map<number, Date>([[2, new Date(NOW - CONDUCT_MARKER_REFRESH_MS - 1)], [3, new Date(NOW - 1_000)]]);
    const a = { tenantId: 1, projectId: 9, title: 't', now: NOW };
    const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
    const db = { update } as never;
    expect(await stampConducted(db, { ...a, taskId: 1 }, markers)).toBe(true);
    expect(await stampConducted(db, { ...a, taskId: 2 }, markers)).toBe(true);
    expect(await stampConducted(db, { ...a, taskId: 3 }, markers)).toBe(false);
    // New ticket: inserted. Stale marker: refreshed in place. Fresh: untouched.
    expect(recordManagerAction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(recordManagerAction.mock.calls[0]![1]).toMatchObject({ taskId: 1, actionType: CONDUCT_MARKER_ACTION });
    // The in-memory map is updated so a second look in the same tick does not re-stamp.
    expect(await stampConducted(db, { ...a, taskId: 1 }, markers)).toBe(false);
  });

  it('reads markers for N tickets in ONE query', async () => {
    const db = markerDb([{ taskId: 1, at: new Date(NOW) }]);
    const out = await loadConductMarkers(db as never, { tenantId: 1, projectId: 9, taskIds: [1, 2, 3, 4] });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect([...out.keys()]).toEqual([1]);
  });
});

describe('triage defers to the sweep only for tickets it conducted recently AND with the control on', () => {
  const rows = [{ taskId: 1, at: new Date(NOW - 60_000) }, { taskId: 2, at: new Date(NOW - 10 * CONDUCT_DEFERRAL_WINDOW_MS) }];

  it('recent marker + control on: ticket 1 is the sweep\'s; stale / never-conducted tickets 2 and 3 keep triage\'s remedy', async () => {
    readCronControls.mockResolvedValue({});
    const owned = await loadSweepOwnedTickets({} as never, markerDb(rows) as never, { tenantId: 1, projectId: 9, taskIds: [1, 2, 3], now: NOW });
    expect([...owned]).toEqual([1]);
    const review = { status: 'in_review' };
    expect(isConductedBySweep(review, 'immediate', false, null, owned.has(1))).toBe(true);
    expect(isConductedBySweep(review, 'immediate', false, null, owned.has(2))).toBe(false);
    expect(isConductedBySweep(review, 'immediate', false, null, owned.has(3))).toBe(false);
  });

  it('reconciler control OFF: nothing is the sweep\'s, however fresh the marker', async () => {
    readCronControls.mockResolvedValue({ 'pr-ticket-reconciler': false });
    const db = markerDb(rows);
    const owned = await loadSweepOwnedTickets({} as never, db as never, { tenantId: 1, projectId: 9, taskIds: [1], now: NOW });
    expect(owned.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('keeps the pure-state behaviour for callers that pass no marker answer', () => {
    expect(isConductedBySweep({ status: 'in_review' }, 'immediate', false)).toBe(true);
    expect(isConductedBySweep({ status: 'in_review' }, 'queue', false, null, true)).toBe(false);
  });
});
