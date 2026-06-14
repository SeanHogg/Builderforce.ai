/**
 * staleExecutionReaper — orphaned-cloud-run re-dispatch (gap hy:orphan-reaper-redispatch).
 *
 * The reaper must SELF-HEAL a stalled cloud run by re-queuing it ONCE on the
 * durable executor (CloudRunnerDO), and must NOT do so when a re-run would double
 * a PR (an open PR already exists) — it fails those instead. We drive the reaper
 * against a tiny in-memory fake of the neon tagged-template SQL so we can assert
 * which executions get re-queued vs failed without a live database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// A controllable fake for the neon tagged-template function. Each test seeds the
// candidate rows + the PR count, and we capture the UPDATEs the reaper issues.
interface Captured {
  failed: number[];
  failedReasons: Map<number, string>;
  requeuedPayloads: Map<number, string>;
  requeueEvents: number[];
}

let candidateRows: Array<Record<string, unknown>> = [];
let captured: Captured;

function makeSql() {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    // SELECT of stale cloud candidates.
    if (text.includes('FROM executions e') && text.includes('JOIN tasks t')) {
      return Promise.resolve(candidateRows);
    }
    // Persist the one-retry flag (requeue path).
    if (text.includes('SET payload =')) {
      captured.requeuedPayloads.set(Number(values[1]), String(values[0]));
      return Promise.resolve([]);
    }
    // Fail a single cloud run by id. UPDATE ... error_message = ${reason} WHERE id = ${id}
    // → values are [reason, id].
    if (text.includes("status = 'failed'") && text.includes('WHERE id =')) {
      const reason = String(values[0]);
      const id = Number(values[1]);
      captured.failed.push(id);
      captured.failedReasons.set(id, reason);
      return Promise.resolve([{ id, tenant_id: 1, agent_host_id: null, payload: null, error_message: reason }]);
    }
    // The host-running + queued sweeps (no candidates in these tests).
    if (text.includes("status = 'failed'")) return Promise.resolve([]);
    // requeue telemetry event.
    if (text.includes("'runtime.requeue'")) {
      // VALUES (tenant_id, NULL, cloud_agent_ref, execution_id, ...) — NULL is a
      // literal so the interpolated values are [tenant_id, cloud_agent_ref, id, ...].
      captured.requeueEvents.push(Number(values[2]));
      return Promise.resolve([]);
    }
    // run.failed telemetry mirror.
    return Promise.resolve([]);
  };
}

vi.mock('@neondatabase/serverless', () => ({
  neon: () => makeSql(),
}));

import { reapStaleExecutions } from './staleExecutionReaper';
import { CLOUD_ORPHAN_REASON, CLOUD_LONG_LIVED_ORPHAN_REASON } from './orphanReasons';

const startMock = vi.fn();

function envWithRunner(ok = true) {
  startMock.mockResolvedValue({ ok });
  return {
    NEON_DATABASE_URL: 'postgres://fake',
    CLOUD_RUNNER: {
      idFromName: (name: string) => ({ name }),
      get: () => ({ fetch: startMock }),
    },
  } as unknown as Parameters<typeof reapStaleExecutions>[0];
}

const STALE_TS = '2000-01-01T00:00:00.000Z'; // far past every deadline

beforeEach(() => {
  candidateRows = [];
  captured = { failed: [], failedReasons: new Map(), requeuedPayloads: new Map(), requeueEvents: [] };
  startMock.mockReset();
});

describe('reapStaleExecutions — orphaned cloud run re-dispatch', () => {
  it('re-dispatches an orphan with no prior work onto CloudRunnerDO (not failed)', async () => {
    candidateRows = [{
      id: 42, tenant_id: 1, agent_host_id: null, payload: '{"model":"m"}', error_message: null,
      task_id: 7, task_title: 'Build feature', task_description: 'do it',
      project_id: 3, cloud_agent_ref: 'agent-x', open_pr_count: 0, updated_at: STALE_TS,
    }];

    const res = await reapStaleExecutions(envWithRunner(true));

    expect(res.requeuedCloud).toBe(1);
    expect(captured.failed).not.toContain(42);
    // Kicked off on the durable executor with the task context + requeue flag.
    expect(startMock).toHaveBeenCalledTimes(1);
    const init = startMock.mock.calls[0]![1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.executionId).toBe(42);
    expect(body.taskId).toBe(7);
    expect(JSON.parse(body.payload).reaperRequeued).toBe(true);
    // The one-retry flag is persisted before kickoff so it can't loop.
    expect(JSON.parse(captured.requeuedPayloads.get(42)!).reaperRequeued).toBe(true);
    expect(captured.requeueEvents).toContain(42);
  });

  it('fails an orphan that already has an open PR (no re-dispatch — avoids a double PR)', async () => {
    candidateRows = [{
      id: 99, tenant_id: 1, agent_host_id: null, payload: '{}', error_message: null,
      task_id: 8, task_title: 'PR task', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 1, updated_at: STALE_TS,
    }];

    const res = await reapStaleExecutions(envWithRunner(true));

    expect(res.requeuedCloud).toBe(0);
    expect(res.failedRunning).toBe(1);
    expect(captured.failed).toContain(99);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('does not re-dispatch a run already re-queued once (only one retry, then fail)', async () => {
    candidateRows = [{
      id: 5, tenant_id: 1, agent_host_id: null, payload: '{"reaperRequeued":true}', error_message: null,
      task_id: 9, task_title: 'Retried', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 0, updated_at: STALE_TS,
    }];

    const res = await reapStaleExecutions(envWithRunner(true));

    expect(res.requeuedCloud).toBe(0);
    expect(captured.failed).toContain(5);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('stamps the LONG-LIVED crash reason (not the serverless ~30s one) on a run that ran past the wall', async () => {
    // Container/durable run that heartbeated for ~77s then went silent — exactly the
    // execution #62 shape. It already used its one retry, so it is failed here.
    candidateRows = [{
      id: 62, tenant_id: 1, agent_host_id: null, payload: '{"reaperRequeued":true}', error_message: null,
      task_id: 78, task_title: 'Avatar filters', task_description: null,
      project_id: 3, cloud_agent_ref: 'bob', open_pr_count: 0,
      started_at: '2026-06-14T23:26:24.000Z', updated_at: '2026-06-14T23:27:41.000Z',
    }];

    await reapStaleExecutions(envWithRunner(true));

    expect(captured.failed).toContain(62);
    expect(captured.failedReasons.get(62)).toBe(CLOUD_LONG_LIVED_ORPHAN_REASON);
    expect(captured.failedReasons.get(62)).not.toBe(CLOUD_ORPHAN_REASON);
  });

  it('stamps the serverless ~30s reason on a short-lived Worker-loop orphan', async () => {
    // No heartbeat past start (started == last activity) → the dying Worker loop.
    candidateRows = [{
      id: 63, tenant_id: 1, agent_host_id: null, payload: '{"reaperRequeued":true}', error_message: null,
      task_id: 79, task_title: 'Quick task', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 0,
      started_at: '2026-06-14T23:26:24.000Z', updated_at: '2026-06-14T23:26:30.000Z',
    }];

    await reapStaleExecutions(envWithRunner(true));

    expect(captured.failed).toContain(63);
    expect(captured.failedReasons.get(63)).toBe(CLOUD_ORPHAN_REASON);
  });
});
