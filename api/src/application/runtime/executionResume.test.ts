/**
 * Resume: a parked run is woken on its durable runner, whatever served its sandbox.
 *
 * Every cloud run is the one engine on its CloudRunnerDO, whose cursor keeps the paused
 * conversation, so the wake is that runner's `/resume` (which also queues a fresh
 * GitHub Actions runner when one was the run's sandbox — CloudRunnerDO). Nothing here
 * may start a second process for the same execution: the runner is the only waker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { PausedRunState } from './executionPause';

const enqueueExecutionMessage = vi.fn(async () => undefined);
const loadPauseState = vi.fn<(db: unknown, args: unknown) => Promise<PausedRunState | null>>();
const clearPauseState = vi.fn(async () => undefined);
const restoreTicketLane = vi.fn(async () => undefined);
const recordCloudToolEvent = vi.fn(async (_db: unknown, _row: unknown) => undefined);

vi.mock('./executionSteering', () => ({ enqueueExecutionMessage: (...a: unknown[]) => enqueueExecutionMessage(...(a as [])) }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: () => undefined }));
vi.mock('./executionPause', () => ({
  loadPauseState: (...a: unknown[]) => loadPauseState(a[0], a[1]),
  clearPauseState: (...a: unknown[]) => clearPauseState(...(a as [])),
  restoreTicketLane: (...a: unknown[]) => restoreTicketLane(...(a as [])),
}));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(a[0], a[1]) }));

import { resumePausedExecution } from './executionResume';

const db = {} as unknown as Db;

/** A durable-runner binding whose `/resume` fetches we can count and answer. */
function cloudRunnerEnv(status = 202): { env: Env; resumes: Array<{ url: string; body: unknown }> } {
  const resumes: Array<{ url: string; body: unknown }> = [];
  const env = {
    CLOUD_RUNNER: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (url: string, init?: RequestInit) => {
          resumes.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
          return new Response('{}', { status });
        },
      }),
    },
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
  for (const m of [enqueueExecutionMessage, loadPauseState, clearPauseState, restoreTicketLane, recordCloudToolEvent]) m.mockClear();
});

describe('resumePausedExecution', () => {
  it('always delivers the answer as a pending user turn', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'use postgres' });
    expect(enqueueExecutionMessage).toHaveBeenCalledWith(db, expect.objectContaining({
      executionId: 99, tenantId: 7, role: 'user', text: 'use postgres', pending: true,
    }));
  });

  it('wakes the durable runner exactly once, carrying the approval id', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a', approvalId: 'appr-1' });
    expect(resumes).toEqual([{ url: 'https://cloud-runner/resume', body: { approvalId: 'appr-1' } }]);
  });

  it('restores the ticket lane before waking, and clears the record after', async () => {
    loadPauseState.mockResolvedValue(pausedOn('durable'));
    const { env } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(restoreTicketLane).toHaveBeenCalledTimes(1);
    expect(clearPauseState).toHaveBeenCalledTimes(1);
  });

  it('an Actions-sandboxed run is woken the same way — the runner re-queues its own sandbox', async () => {
    loadPauseState.mockResolvedValue(pausedOn('github_actions'));
    const { env, resumes } = cloudRunnerEnv();
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(resumes).toHaveLength(1);
    expect(recordCloudToolEvent).not.toHaveBeenCalled();
  });

  it('says why when a legacy pause has no runner cursor to continue from (409)', async () => {
    loadPauseState.mockResolvedValue(pausedOn('container'));
    const { env } = cloudRunnerEnv(409);
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(recordCloudToolEvent).toHaveBeenCalledTimes(1);
    const row = recordCloudToolEvent.mock.calls[0]![1] as { toolName: string; result: string };
    expect(row.toolName).toBe('run.resume_failed');
    expect(row.result).toMatch(/follow-up run/);
  });

  it('a pause with no record still wakes the runner and writes no failure', async () => {
    loadPauseState.mockResolvedValue(null);
    const { env, resumes } = cloudRunnerEnv(409);
    await resumePausedExecution(env, db, { executionId: 99, tenantId: 7, answer: 'a' });
    expect(resumes).toHaveLength(1);
    expect(recordCloudToolEvent).not.toHaveBeenCalled();
    expect(clearPauseState).not.toHaveBeenCalled();
  });
});
