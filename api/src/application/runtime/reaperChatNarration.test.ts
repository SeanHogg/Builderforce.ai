import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript, type ReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';

/**
 * Cron-reaper -> canonical status fan-out. The stale-execution reaper fails runs with set-based
 * UPDATEs, bypassing RuntimeService.update. A run that died silently (hung host, evicted cloud
 * isolate, dropped queue, abandoned ask_human) must still owe the SAME side effects update() fires
 * for a FAILED run - task-lane sync + ticket metrics, the managed callback, attribution, the audit
 * event and the narration into the linked Brain chats - so each reaped row is handed to the shared
 * fan-out (`RuntimeService.settleLandedFailures` -> executionLandedEffects). What the fan-out DOES
 * with a row is proven in executionLandedEffects.test.ts; this file proves the reaper hands over
 * every reaped row, from every sweep, in the shape the fan-out reads.
 */

const h = vi.hoisted(() => ({
  reapedRunningRows: [] as Array<Record<string, unknown>>,
  reapedQueuedRows: [] as Array<Record<string, unknown>>,
  reapedPausedRows: [] as Array<Record<string, unknown>>,
}));

let script: ReaperFakeDbScript;

function newScript(): ReaperFakeDbScript {
  return newReaperFakeDbScript({
    // The idle probe flags exactly the sweeps that have rows, as the real EXISTS arms do.
    probe: () => ({
      host_running: h.reapedRunningRows.length > 0,
      cloud_running: false, // stale cloud candidates - none in these tests
      queued: h.reapedQueuedRows.length > 0,
      paused: h.reapedPausedRows.length > 0,
      park_age: false,
    }),
    // Each batched sweep binds its own status value first; the principal revocation
    // (status 'revoked') binds execution ids and reaps nothing.
    onUpdate: (set, params) => {
      if (set.status !== 'failed') return [];
      if (params[0] === 'paused') return h.reapedPausedRows;
      if (params.includes('submitted')) return h.reapedQueuedRows;
      if (params[0] === 'running') return h.reapedRunningRows;
      return [];
    },
  });
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => createReaperFakeDb(script),
}));
vi.mock('../maintenance/parkAgeTimeout', async (importOriginal) => ({
  // Keep the real cutoff resolver (the reaper reads it for the probe); stub only the sweep.
  ...(await importOriginal<typeof import('../maintenance/parkAgeTimeout')>()),
  runParkAgeTimeoutSweep: async () => ({ stale: 0, unparked: 0 }),
}));

import { reapStaleExecutions, type SettleReapedFailures } from './staleExecutionReaper';
import { PAUSED_ORPHAN_REASON } from './orphanReasons';

const env = { NEON_DATABASE_URL: 'postgres://fake' } as unknown as Parameters<typeof reapStaleExecutions>[0];
const NOW = Date.parse('2026-07-24T12:00:00.000Z');
const settle = vi.fn<SettleReapedFailures>(async () => undefined);
const reap = () => reapStaleExecutions(env, NOW, createReaperFakeDb(script) as never, settle);

beforeEach(() => {
  h.reapedRunningRows.length = 0;
  h.reapedQueuedRows.length = 0;
  h.reapedPausedRows.length = 0;
  settle.mockClear();
  script = newScript();
});

describe('reapStaleExecutions - hand-off to the canonical failed-run fan-out', () => {
  it('hands a reaped hung run to the fan-out with its ticket, agent attribution and reason', async () => {
    h.reapedRunningRows.push({
      id: 301, tenant_id: 4, agent_host_id: 9, payload: '{"cloudAgentRef":"agent-x"}',
      error_message: 'Execution timed out - the agent did not report completion.', task_id: 55, cloud_agent_ref: null,
    });

    await reap();

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith([{
      id: 301, tenantId: 4, taskId: 55, payload: '{"cloudAgentRef":"agent-x"}',
      cloudAgentRef: 'agent-x', agentHostId: 9,
      errorMessage: 'Execution timed out - the agent did not report completion.',
    }]);
  });

  it('hands an abandoned ask_human pause over with its actionable release reason', async () => {
    h.reapedPausedRows.push({
      id: 77, tenant_id: 1, agent_host_id: null, payload: null,
      error_message: PAUSED_ORPHAN_REASON, task_id: 12, cloud_agent_ref: null,
    });

    await reap();

    expect(settle).toHaveBeenCalledWith([expect.objectContaining({ id: 77, taskId: 12, errorMessage: PAUSED_ORPHAN_REASON })]);
  });

  it('hands dropped-queue runs (never picked up) over too, in ONE call across every sweep', async () => {
    h.reapedRunningRows.push({ id: 1, tenant_id: 1, agent_host_id: 9, payload: null, error_message: 'x', task_id: 10, cloud_agent_ref: null });
    h.reapedQueuedRows.push({ id: 88, tenant_id: 2, agent_host_id: null, payload: null, error_message: 'q', task_id: 30, cloud_agent_ref: 'agent-q' });
    h.reapedPausedRows.push({ id: 3, tenant_id: 1, agent_host_id: null, payload: null, error_message: 'x', task_id: 12, cloud_agent_ref: null });

    await reap();

    expect(settle).toHaveBeenCalledTimes(1);
    const runs = settle.mock.calls[0]![0] as unknown as Array<{ id: number; cloudAgentRef: string | null }>;
    expect(runs.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 3, 88]);
    expect(runs.find((r) => r.id === 88)!.cloudAgentRef).toBe('agent-q');
  });

  it('skips a run that served no ticket (nothing to sync or narrate)', async () => {
    h.reapedRunningRows.push({ id: 5, tenant_id: 1, agent_host_id: 9, payload: null, error_message: 'x', task_id: null, cloud_agent_ref: null });

    await reap();

    expect(settle).toHaveBeenCalledWith([]);
  });

  it('survives a failing fan-out: the sweep still returns its counts', async () => {
    h.reapedRunningRows.push({ id: 6, tenant_id: 1, agent_host_id: 9, payload: null, error_message: 'x', task_id: 10, cloud_agent_ref: null });
    settle.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await reap();

    expect(res.failedRunning).toBe(1);
    errorSpy.mockRestore();
  });

  it('hands over an empty list (and touches no other statement) when the sweep reaped nothing', async () => {
    const res = await reap();
    expect(res.failedRunning + res.failedQueued + res.failedPaused).toBe(0);
    expect(settle).not.toHaveBeenCalled();
  });
});
