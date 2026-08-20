/**
 * GAP-S5 / GAP-S6 — the cloud-Worker fallback loop is a SERVER-SIDE bounded loop
 * with no live session, so steering and cancellation cannot ride the relay the way
 * they do for a self-hosted host. They have to be cooperative: checked BETWEEN
 * iterations, against the durable stores.
 *
 * These are the two contracts that make that real, driven through the primitive the
 * loop and the container `llm` op both call:
 *
 *   • a steer posted mid-run is drained and injected as the NEXT user turn of the
 *     loop's message array (not silently dropped), exactly once;
 *   • a cancelled run stops between iterations and never issues another paid call.
 *
 * `pullPendingSteering` (the durable drain) is mocked so the test drives the
 * injection contract, not Drizzle; the telemetry writes go through the real
 * `recordCloudToolEvent` against a fake Db, matching cloudTelemetry.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ pending: [] as string[][] }));

vi.mock('./executionSteering', () => ({
  pullPendingSteering: vi.fn(async () => h.pending.shift() ?? []),
  releasePendingSteers: vi.fn(async () => 0),
}));

import {
  applyPendingSteering,
  startCancelWatcher,
  CANCEL_POLL_MS,
  type LoopMessage,
} from './cloudLoopControl';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

function makeFakeDb() {
  const inserts: Array<{ table: unknown; row: Record<string, unknown> }> = [];
  const db = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => { inserts.push({ table, row }); },
    }),
  } as unknown as Db;
  return { db, rowsFor: (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.row) };
}

const RUN = { tenantId: 1, cloudAgentRef: 'agent-x', executionId: 42 };

beforeEach(() => { h.pending.length = 0; });

describe('applyPendingSteering — mid-loop injection (GAP-S5)', () => {
  it('injects each pending steer as the next user turn of the live conversation', async () => {
    const { db } = makeFakeDb();
    h.pending.push(['use the v2 endpoint instead', 'and add a test']);
    const messages: LoopMessage[] = [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'implement the ticket' },
      { role: 'assistant', content: 'starting' },
    ];

    const drained = await applyPendingSteering(db, { ...RUN, messages, step: 3 });

    expect(drained).toEqual(['use the v2 endpoint instead', 'and add a test']);
    // Appended at the END, in the order the user sent them — the next thing the model reads.
    expect(messages.slice(3)).toEqual([
      { role: 'user', content: 'use the v2 endpoint instead' },
      { role: 'user', content: 'and add a test' },
    ]);
  });

  it('records a steer.applied timeline event per steer, attributed to the run', async () => {
    const { db, rowsFor } = makeFakeDb();
    h.pending.push(['change course']);
    const messages: LoopMessage[] = [{ role: 'user', content: 'go' }];

    await applyPendingSteering(db, { ...RUN, messages, step: 2 });

    const rows = rowsFor(toolAuditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 1,
      cloudAgentRef: 'agent-x',
      executionId: 42,
      sessionKey: 'exec:42',
      toolName: 'steer.applied',
      category: 'message',
      result: 'change course',
    });
    expect(JSON.parse(rows[0]!.args as string)).toEqual({ step: 2, text: 'change course' });
  });

  it('is a cheap no-op when nothing is pending (the common case)', async () => {
    const { db, rowsFor } = makeFakeDb();
    const messages: LoopMessage[] = [{ role: 'user', content: 'go' }];

    expect(await applyPendingSteering(db, { ...RUN, messages })).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(rowsFor(toolAuditEvents)).toHaveLength(0);
  });

  it('does not double a steer the caller already holds (the container returns its own state)', async () => {
    const { db, rowsFor } = makeFakeDb();
    h.pending.push(['already adopted']);
    // The container hands its loop state back on every op — the steer is already a turn.
    const messages: LoopMessage[] = [{ role: 'user', content: 'go' }, { role: 'user', content: 'already adopted' }];

    await applyPendingSteering(db, { ...RUN, messages });

    expect(messages).toHaveLength(2);
    // Still recorded on the timeline — it WAS applied, it just did not need re-appending.
    expect(rowsFor(toolAuditEvents)).toHaveLength(1);
  });

  it('delivers a steer exactly once across iterations (the drain stamps it consumed)', async () => {
    const { db } = makeFakeDb();
    h.pending.push(['only once']);       // iteration 1 drains it
    h.pending.push([]);                  // iteration 2 sees nothing pending
    const messages: LoopMessage[] = [{ role: 'user', content: 'go' }];

    await applyPendingSteering(db, { ...RUN, messages, step: 0 });
    await applyPendingSteering(db, { ...RUN, messages, step: 1 });

    expect(messages.filter((m) => m.content === 'only once')).toHaveLength(1);
  });
});

describe('startCancelWatcher — cooperative cancellation (GAP-S6)', () => {
  it('stops a bounded loop BETWEEN iterations and never issues the next paid call', async () => {
    let status: 'running' | 'cancelled' = 'running';
    const cancel = startCancelWatcher(async () => status === 'cancelled', { intervalMs: 10_000 });
    const paidCalls: number[] = [];
    let stoppedAt = -1;

    try {
      for (let step = 0; step < 5; step++) {
        if (await cancel.check()) { stoppedAt = step; break; }
        paidCalls.push(step);
        // The user cancels while step 1's tool work is running.
        if (step === 1) status = 'cancelled';
      }
    } finally {
      cancel.stop();
    }

    expect(paidCalls).toEqual([0, 1]);       // step 2 was never dispatched
    expect(stoppedAt).toBe(2);
    expect(cancel.cancelled()).toBe(true);
  });

  it('aborts the in-flight request signal on the first observation, so token spend stops mid-call', async () => {
    const cancel = startCancelWatcher(async () => true, { intervalMs: 10_000 });
    expect(cancel.controller.signal.aborted).toBe(false);
    await cancel.check();
    expect(cancel.controller.signal.aborted).toBe(true);
    cancel.stop();
  });

  it('the background poll cancels a run even while a long step is in flight', async () => {
    let status = 'running';
    const sleeps: number[] = [];
    const cancel = startCancelWatcher(async () => status === 'cancelled', {
      intervalMs: 5,
      sleep: async (ms) => { sleeps.push(ms); await new Promise((r) => setTimeout(r, 1)); },
    });
    status = 'cancelled';
    // Let the watcher poll at least once.
    await new Promise((r) => setTimeout(r, 30));
    expect(cancel.cancelled()).toBe(true);
    expect(cancel.controller.signal.aborted).toBe(true);
    expect(sleeps[0]).toBe(5);
    cancel.stop();
  });

  it('a transient cancel-source read failure never cancels a healthy run', async () => {
    let calls = 0;
    const cancel = startCancelWatcher(async () => {
      calls++;
      throw new Error('db unreachable');
    }, { intervalMs: 10_000 });

    expect(await cancel.check()).toBe(false);
    expect(cancel.cancelled()).toBe(false);
    expect(calls).toBe(1);
    cancel.stop();
  });

  it('stop() ends the watcher so its timer cannot outlive the run', async () => {
    let polls = 0;
    const cancel = startCancelWatcher(async () => { polls++; return false; }, {
      intervalMs: 1,
      sleep: async () => { await new Promise((r) => setTimeout(r, 1)); },
    });
    await new Promise((r) => setTimeout(r, 20));
    cancel.stop();
    const after = polls;
    await new Promise((r) => setTimeout(r, 20));
    expect(polls).toBeLessThanOrEqual(after + 1); // at most the poll already in flight
  });

  it('defaults to the shared poll interval', () => {
    expect(CANCEL_POLL_MS).toBe(2000);
  });
});

describe('steering + cancellation compose in one loop (the fallback-run contract)', () => {
  it('applies a steer, then honours a cancel on the following iteration', async () => {
    const { db } = makeFakeDb();
    let status: 'running' | 'cancelled' = 'running';
    const cancel = startCancelWatcher(async () => status === 'cancelled', { intervalMs: 10_000 });
    const messages: LoopMessage[] = [{ role: 'user', content: 'implement it' }];
    h.pending.push([]);                       // iteration 0: nothing pending
    h.pending.push(['actually, stop after the readme']); // iteration 1: a steer lands
    const turns: string[] = [];

    try {
      for (let step = 0; step < 4; step++) {
        if (await cancel.check()) break;
        await applyPendingSteering(db, { ...RUN, messages, step });
        turns.push(`turn-${step}`);
        if (step === 1) status = 'cancelled';
      }
    } finally {
      cancel.stop();
    }

    expect(turns).toEqual(['turn-0', 'turn-1']);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'actually, stop after the readme' });
    expect(cancel.cancelled()).toBe(true);
  });
});
