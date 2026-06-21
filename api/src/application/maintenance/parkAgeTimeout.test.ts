/**
 * parkAgeTimeout — the fallback edge for tickets stuck on a never-settling
 * run_workflow park. Drives the sweep against an in-memory Drizzle fake so we can
 * assert the unpark UPDATE + the swimlane_transitions audit row without a live DB.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Captured side effects + seeded stale rows for one test.
interface Captured {
  updates: Array<{ set: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
}
let staleRows: Array<Record<string, unknown>> = [];
let updateReturns: Array<Array<{ id: string }>> = []; // per-update .returning() result
let captured: Captured;

// Minimal fake of the drizzle-orm/neon-http builder chain the sweep uses:
//   db.select(...).from(t).where(...)            -> Promise<rows>
//   db.update(t).set(s).where(...).returning(...) -> Promise<rows>
//   db.insert(t).values(v)                        -> Promise<void>
function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(staleRows),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            captured.updates.push({ set });
            const next = updateReturns.shift() ?? [{ id: 'row' }];
            return Promise.resolve(next);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
}

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => fakeDb(),
}));

import {
  runParkAgeTimeoutSweep,
  resolveParkAgeTimeoutMs,
  DEFAULT_PARK_AGE_TIMEOUT_MS,
} from './parkAgeTimeout';

const env = { NEON_DATABASE_URL: 'postgres://fake' };

beforeEach(() => {
  staleRows = [];
  updateReturns = [];
  captured = { updates: [], inserts: [] };
});

describe('resolveParkAgeTimeoutMs', () => {
  it('defaults when unset / invalid', () => {
    expect(resolveParkAgeTimeoutMs(env)).toBe(DEFAULT_PARK_AGE_TIMEOUT_MS);
    expect(resolveParkAgeTimeoutMs({ ...env, PARK_AGE_TIMEOUT_MS: 'nope' })).toBe(DEFAULT_PARK_AGE_TIMEOUT_MS);
    expect(resolveParkAgeTimeoutMs({ ...env, PARK_AGE_TIMEOUT_MS: 0 })).toBe(DEFAULT_PARK_AGE_TIMEOUT_MS);
    expect(resolveParkAgeTimeoutMs({ ...env, PARK_AGE_TIMEOUT_MS: -5 })).toBe(DEFAULT_PARK_AGE_TIMEOUT_MS);
  });
  it('honours a positive override (string or number)', () => {
    expect(resolveParkAgeTimeoutMs({ ...env, PARK_AGE_TIMEOUT_MS: '90000' })).toBe(90000);
    expect(resolveParkAgeTimeoutMs({ ...env, PARK_AGE_TIMEOUT_MS: 12345 })).toBe(12345);
  });
});

describe('runParkAgeTimeoutSweep', () => {
  it('no-ops when nothing is parked past the cap', async () => {
    const res = await runParkAgeTimeoutSweep(env);
    expect(res).toEqual({ stale: 0, unparked: 0 });
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(0);
  });

  it('unparks a stale ticket to needs_attention + writes a timeline transition', async () => {
    staleRows = [
      { id: 'tr-1', tenantId: 7, currentSwimlaneId: 'sl-1', awaitingWorkflowId: 'wf-1' },
    ];
    const res = await runParkAgeTimeoutSweep(env, 1_000_000_000);

    expect(res).toEqual({ stale: 1, unparked: 1 });

    // The lifecycle move + dangling-ref clear.
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]!.set).toMatchObject({
      lifecycle: 'needs_attention',
      awaitingWorkflowId: null,
    });
    expect(String(captured.updates[0]!.set.error)).toContain('Park-age timeout');

    // The audit/timeline signal.
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0]).toMatchObject({
      tenantId: 7,
      ticketRunId: 'tr-1',
      reason: 'failed',
    });
    expect(String(captured.inserts[0]!.detail)).toContain('Park-age timeout');
  });

  it('skips a ticket that raced (settled/unparked elsewhere) — no transition row', async () => {
    staleRows = [
      { id: 'tr-1', tenantId: 7, currentSwimlaneId: 'sl-1', awaitingWorkflowId: 'wf-1' },
    ];
    updateReturns = [[]]; // the guarded UPDATE matched 0 rows (no longer parked)

    const res = await runParkAgeTimeoutSweep(env, 1_000_000_000);

    expect(res).toEqual({ stale: 1, unparked: 0 });
    expect(captured.inserts).toHaveLength(0); // no audit row for a raced unpark
  });

  it('counts only the rows it actually moved when several are stale', async () => {
    staleRows = [
      { id: 'a', tenantId: 1, currentSwimlaneId: 's', awaitingWorkflowId: 'w' },
      { id: 'b', tenantId: 1, currentSwimlaneId: 's', awaitingWorkflowId: 'w' },
      { id: 'c', tenantId: 1, currentSwimlaneId: 's', awaitingWorkflowId: 'w' },
    ];
    updateReturns = [[{ id: 'a' }], [], [{ id: 'c' }]]; // b raced

    const res = await runParkAgeTimeoutSweep(env, 1_000_000_000);

    expect(res).toEqual({ stale: 3, unparked: 2 });
    expect(captured.inserts.map((i) => i.ticketRunId)).toEqual(['a', 'c']);
  });
});
