/**
 * Resume routing: a parked run must be woken on the ONE surface that parked it.
 *
 * This is the half that used to be wrong. `resumePausedExecution` only ever POSTed
 * the durable runner's `/resume`, which is a no-op for a container or GitHub Actions
 * run — those exit their process on pause, so nothing was ever restarted and the
 * human's answer sat queued forever.
 *
 * Waking the WRONG surface is worse than waking none: the two redispatch surfaces
 * start a new process for the same execution id, so "just wake everything" would
 * run one execution twice, concurrently, against one ticket branch. Hence the
 * recorded surface decides, and these tests pin exactly one wake per pause.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { PausedRunState } from './executionPause';

const enqueueExecutionMessage = vi.fn(async () => undefined);
const loadPauseState = vi.fn<(db: unknown, args: unknown) => Promise<PausedRunState | null>>();
const clearPauseState = vi.fn(async () => undefined);
const restoreTicketLane = vi.fn(async () => undefined);
const launchContainerRun = vi.fn(async () => ({ ok: true as const }));
const dispatchGithubActionsRun = vi.fn(async () => ({ ok: true as const }));
const loadContainerRunContext = vi.fn(async () => ({
  tenantId: 7, taskId: 11, projectId: 3, taskTitle: 'T', taskDescription: null,
  cloudAgentRef: 'agent-1', agentLabel: 'Agent',
}));
const markCloudExecutionRunning = vi.fn(async () => undefined);
const recordCloudToolEvent = vi.fn(async () => undefined);
/** Whether the container /health probe answers. Flipped per test. */
let containerHealthy = true;

vi.mock('./executionSteering', () => ({ enqueueExecutionMessage: (...a: unknown[]) => enqueueExecutionMessage(...(a as [])) }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: () => undefined }));
vi.mock('./executionPause', () => ({
  loadPauseState: (...a: unknown[]) => loadPauseState(a[0], a[1]),
  clearPauseState: (...a: unknown[]) => clearPauseState(...(a as [])),
  restoreTicketLane: (...a: unknown[]) => restoreTicketLane(...(a as [])),
}));
vi.mock('./containerRunLauncher', () => ({ launchContainerRun: (...a: unknown[]) => launchContainerRun(...(a as [])) }));
vi.mock('./githubActionsDispatch', () => ({ dispatchGithubActionsRun: (...a: unknown[]) => dispatchGithubActionsRun(...(a as [])) }));
vi.mock('./cloudDispatch', () => ({ probeContainerHealth: () => containerHealthy }));
vi.mock('./cloudAgentEngine', () => ({
  loadContainerRunContext: (...a: unknown[]) => loadContainerRunContext(...(a as [])),
  markCloudExecutionRunning: (...a: unknown[]) => markCloudExecutionRunning(...(a as [])),
}));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(...(a as [])) }));
vi.mock('../artifact/resolveArtifacts', () => ({ resolveArtifacts: async () => undefined }));

import { resumePausedExecution } from './executionResume';

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ payload: '{"model":"m"}' }]) }) }) }),
} as unknown as Db;

const runtimeService = {
  postLifecycleMilestoneById: vi.fn(async () => undefined),
} as never;

/** A durable-runner binding whose `/resume` fetches we can count. */
function cloudRunnerEnv(): { env: Env; resumes: string[] } {
  const resumes: string[] = [];
  const env = {
    CLOUD_RUNNER: {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async (url: string) => { resumes.push(url); return new Response('{}'); } }),
    },
    AGENT_CONTAINER: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) },
  } as unknown as Env;
  return { env, resumes };
}

function pausedOn(surface: PausedRunState['surface']): PausedRunState {
  return {
    executionId: 99, tenantId: 7, taskId: 11, surface,
    approvalId: 'appr-1', originLane: 'in_progress', routedLane: 'blocked',
    loopState: { messages: [{ role: 'user', content: 'go' }], writtenPaths: ['a.ts'], step: 6 },
  };
}

beforeEach(() => {
  for (const m of [enqueueExecutionMessage, loadPauseState, clearPauseState, restoreTicketLane,
    launchContainerRun, dispatchGithubActionsRun, loadContainerRunContext, markCloudExecutionRunning,
    recordCloudToolEvent]) m.mockClear();
  launchContainerRun.mockResolvedValue({ ok: true });
  dispatchGithubActionsRun.mockResolvedValue({ ok: true });
  containerHealthy = true;
});

describe('resumePausedExecution — surface routing', () => {
  it('always delivers the answer as a pending user turn, whatever the surface', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'use postgres' });
    expect(enqueueExecutionMessage).toHaveBeenCalledWith(db, expect.objectContaining({
      executionId: 99, tenantId: 7, role: 'user', text: 'use postgres', pending: true,
    }));
  });

  it('wakes ONLY the durable runner for a durable pause', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(resumes).toEqual(['https://cloud-runner/resume']);
    expect(launchContainerRun).not.toHaveBeenCalled();
    expect(dispatchGithubActionsRun).not.toHaveBeenCalled();
  });

  it('relaunches the container — seeded with the paused conversation — and does NOT touch the durable runner', async () => {
    loadPauseState.mockResolvedValue(pausedOn('container'));
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
    expect(resumes).toEqual([]);
    expect(dispatchGithubActionsRun).not.toHaveBeenCalled();
    expect(launchContainerRun).toHaveBeenCalledTimes(1);
    const call = launchContainerRun.mock.calls[0] as unknown[];
    expect((call[3] as { resume?: unknown }).resume).toEqual({
      messages: [{ role: 'user', content: 'go' }], writtenPaths: ['a.ts'], step: 6,
    });
    // The relaunched process drives the loop via callbacks that only settle the row
    // at finalize, so the resume owns the running transition — exactly as dispatch does.
    expect(markCloudExecutionRunning).toHaveBeenCalled();
  });

  it('re-dispatches the workflow for a GitHub Actions pause', async () => {
    loadPauseState.mockResolvedValue(pausedOn('github_actions'));
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
    expect(resumes).toEqual([]);
    expect(launchContainerRun).not.toHaveBeenCalled();
    expect(dispatchGithubActionsRun).toHaveBeenCalledWith(env, db, { tenantId: 7, taskId: 11, executionId: 99 });
  });

  it('leaves the Actions resume record in place — the runner only reads it minutes later, from `spec`', async () => {
    loadPauseState.mockResolvedValue(pausedOn('github_actions'));
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
    expect(clearPauseState).not.toHaveBeenCalled();
  });

  it('clears the record on the surfaces that have already consumed it', async () => {
    for (const surface of ['durable', 'container'] as const) {
      clearPauseState.mockClear();
      loadPauseState.mockResolvedValue(pausedOn(surface));
      const { env } = cloudRunnerEnv();
      await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
      expect(clearPauseState).toHaveBeenCalledWith(db, { tenantId: 7, executionId: 99 });
    }
  });

  it('restores the ticket to its origin lane before waking anything', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(restoreTicketLane).toHaveBeenCalledWith(env, db, expect.objectContaining({ originLane: 'in_progress', routedLane: 'blocked' }));
  });

  it('falls back to the durable wake for a run parked before resume records existed', async () => {
    loadPauseState.mockResolvedValue(null);
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(resumes).toEqual(['https://cloud-runner/resume']);
    expect(launchContainerRun).not.toHaveBeenCalled();
    expect(clearPauseState).not.toHaveBeenCalled();
  });

  it('refuses to relaunch into a dead container — the DO acks /run even when the image cannot boot', async () => {
    loadPauseState.mockResolvedValue(pausedOn('container'));
    containerHealthy = false;
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
    expect(launchContainerRun).not.toHaveBeenCalled();
    // Left `paused` with the answer queued rather than flipped `running` and reaped.
    expect(markCloudExecutionRunning).not.toHaveBeenCalled();
    expect(recordCloudToolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'run.resume_failed' }));
  });

  it('records WHY nothing woke up when the relaunch fails, and leaves the run resumable', async () => {
    loadPauseState.mockResolvedValue(pausedOn('container'));
    launchContainerRun.mockResolvedValue({ ok: false, reason: 'AgentContainerDO /run 503' } as never);
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', runtimeService });
    expect(recordCloudToolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'run.resume_failed' }));
    expect(markCloudExecutionRunning).not.toHaveBeenCalled();
  });
});
