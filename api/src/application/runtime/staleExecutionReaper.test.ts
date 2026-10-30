/**
 * staleExecutionReaper — orphaned-cloud-run re-dispatch (gap hy:orphan-reaper-redispatch).
 *
 * The reaper must SELF-HEAL a stalled cloud run by re-queuing it ONCE on the
 * durable executor (CloudRunnerDO), and must NOT do so when a re-run would double
 * a PR (an open PR already exists) — it fails those instead. We drive the reaper
 * against a tiny in-memory fake of the Drizzle builder chain so we can assert
 * which executions get re-queued vs failed without a live database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript, type ReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';

// A controllable fake of the Drizzle `Db` (shared fixture). Each test seeds the candidate
// rows + the PR count, and we capture the UPDATEs/INSERTs the reaper issues. Sweeps are
// told apart by the `set` payload they write plus the bound params of their WHERE.
interface Captured {
  failed: number[];
  failedReasons: Map<number, string>;
  requeuedPayloads: Map<number, string>;
  requeueEvents: number[];
}

let captured: Captured;
let script: ReaperFakeDbScript;

function newScript(): ReaperFakeDbScript {
  return newReaperFakeDbScript({
    onUpdate: (set, params) => {
      const id = Number(params[0]);
      // Persist the one-retry flag (requeue path) — payload-only update.
      if (set.status === undefined && set.payload !== undefined) {
        captured.requeuedPayloads.set(id, String(set.payload));
        return [];
      }
      // Fail ONE cloud run by id: `where id = $1 and status = $2` binds the id first.
      // The batched running/queued/paused sweeps bind a status string there instead.
      if (set.status === 'failed' && Number.isFinite(id)) {
        const reason = String(set.errorMessage);
        captured.failed.push(id);
        captured.failedReasons.set(id, reason);
        return [{ id, tenant_id: 1, agent_host_id: null, payload: null, error_message: reason }];
      }
      // The host-running + queued + paused sweeps (no candidates in these tests).
      return [];
    },
    onInsert: (v) => {
      if (v.toolName === 'runtime.requeue') captured.requeueEvents.push(Number(v.executionId));
    },
  });
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => createReaperFakeDb(script),
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
  script = newScript();
  captured = { failed: [], failedReasons: new Map(), requeuedPayloads: new Map(), requeueEvents: [] };
  startMock.mockReset();
});

describe('reapStaleExecutions — orphaned cloud run re-dispatch', () => {
  it('re-dispatches an orphan with no prior work onto CloudRunnerDO (not failed)', async () => {
    script.candidates = [{
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
    script.candidates = [{
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
    script.candidates = [{
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
    script.candidates = [{
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
    script.candidates = [{
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

describe('reapStaleExecutions — per-surface silence ceiling (execution #136)', () => {
  const NOW = Date.parse('2026-07-01T00:00:00.000Z');
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it('SPARES a durable run mid a slow LLM step (93s of silence < long-lived ceiling) — not failed, not requeued', async () => {
    // The exact #136 shape: a durable tick made ONE 93s LLM call, so updated_at is 93s
    // stale — past the 90s pull floor but WELL inside the durable ceiling. The run is
    // alive (mid-completion), so the reaper must leave it be.
    script.candidates = [{
      id: 136, tenant_id: 1, agent_host_id: null, payload: '{"executor":"durable","model":"m"}', error_message: null,
      task_id: 79, task_title: 'OKR 4', task_description: null,
      project_id: 3, cloud_agent_ref: 'kevin', open_pr_count: 0,
      started_at: iso(5 * 60_000), updated_at: iso(93_000),
    }];

    const res = await reapStaleExecutions(envWithRunner(true), NOW);

    expect(res.requeuedCloud).toBe(0);
    expect(res.failedRunning).toBe(0);
    expect(captured.failed).not.toContain(136);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('SPARES a run stamped with the REMOVED serverless worker executor at 93s — an unknown executor gets the long-lived ceiling', async () => {
    // The in-request 'worker' executor no longer exists, so nothing stamps this and
    // `parseExecutor` reads it as unknown. A payload written before it was removed must
    // therefore fall to the long-lived ceiling: there is no longer a surface that dies
    // silently at ~30s, and reaping a possibly-live run is the worse failure mode.
    script.candidates = [{
      id: 200, tenant_id: 1, agent_host_id: null, payload: '{"executor":"worker","reaperRequeued":true}', error_message: null,
      task_id: 80, task_title: 'Quick', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 0,
      started_at: iso(93_000), updated_at: iso(93_000),
    }];

    const res = await reapStaleExecutions(envWithRunner(true), NOW);

    expect(res.failedRunning).toBe(0);
    expect(captured.failed).not.toContain(200);
  });

  it('REAPS a durable run that is genuinely silent (past the long-lived ceiling)', async () => {
    script.candidates = [{
      id: 201, tenant_id: 1, agent_host_id: null, payload: '{"executor":"durable","reaperRequeued":true}', error_message: null,
      task_id: 81, task_title: 'Dead', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 0,
      started_at: iso(10 * 60_000), updated_at: iso(6 * 60_000),
    }];

    const res = await reapStaleExecutions(envWithRunner(true), NOW);

    expect(res.failedRunning).toBe(1);
    expect(captured.failed).toContain(201);
  });
});

describe('reapStaleExecutions — idle probe', () => {
  it('issues ONLY the probe when nothing is stale (no UPDATE, no candidate SELECT, no park-age sweep)', async () => {
    const res = await reapStaleExecutions(envWithRunner(true));

    expect(script.calls).toEqual(['execute']);
    expect(res).toEqual({ failedRunning: 0, failedQueued: 0, failedPaused: 0, requeuedCloud: 0, parkAge: { stale: 0, unparked: 0 } });
  });

  it('runs only the sweeps the probe flagged', async () => {
    script.probe = () => ({ host_running: false, cloud_running: false, queued: true, paused: false, park_age: false });

    await reapStaleExecutions(envWithRunner(true));

    // The queued UPDATE runs; the cloud candidate SELECT does not.
    expect(script.calls).toContain('execute');
    expect(script.calls).toContain('update');
    expect(script.calls).not.toContain('candidates');
  });

  it('accepts text-typed booleans from the probe', async () => {
    script.probe = () => ({ host_running: 'f', cloud_running: 't', queued: 'f', paused: 'f', park_age: 'f' });
    script.candidates = [{
      id: 7, tenant_id: 1, agent_host_id: null, payload: '{"reaperRequeued":true}', error_message: null,
      task_id: 1, task_title: 'x', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 0, updated_at: STALE_TS,
    }];

    await reapStaleExecutions(envWithRunner(true));

    expect(captured.failed).toContain(7);
  });
});

describe("reapStaleExecutions - a later batch failing never loses an earlier batch's outcome rows", () => {
  it("the cloud-running sweep's run.outcome rows are written right after ITS update, before the queued sweep throws", async () => {
    const outcomes: Array<{ executionId: number; terminalStatus: string }> = [];
    script = newReaperFakeDbScript({
      probe: () => ({ host_running: false, cloud_running: true, queued: true, paused: false, park_age: false }),
      onUpdate: (set, params) => {
        if (set.errorMessage === 'Execution was never picked up by an agent within the dispatch window.') throw new Error('database went away mid-sweep');
        const id = Number(params[0]);
        return set.status === 'failed' && Number.isFinite(id)
          ? [{ id, tenant_id: 1, agent_host_id: null, cloud_agent_ref: null, payload: null, error_message: String(set.errorMessage) }]
          : [];
      },
      onInsert: (v) => {
        if (v.toolName === 'run.outcome') outcomes.push({ executionId: Number(v.executionId), terminalStatus: String((JSON.parse(String(v.args)) as { terminalStatus: string }).terminalStatus) });
      },
    });
    script.candidates = [{
      id: 99, tenant_id: 1, agent_host_id: null, payload: '{}', error_message: null,
      task_id: 8, task_title: 'PR task', task_description: null,
      project_id: 3, cloud_agent_ref: null, open_pr_count: 1, updated_at: STALE_TS,
    }];

    await reapStaleExecutions(envWithRunner(true)).catch(() => undefined);

    expect(outcomes).toEqual([{ executionId: 99, terminalStatus: 'failed' }]);
  });
});
