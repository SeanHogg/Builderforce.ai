import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

const mocks = vi.hoisted(() => ({
  readLaneRouting: vi.fn(),
  invalidateLaneRouting: vi.fn().mockResolvedValue(undefined),
  enterLaneForTask: vi.fn(),
  admitStageEntry: vi.fn(),
  recordStageRefusal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./laneRouting', () => ({ readLaneRouting: mocks.readLaneRouting, invalidateLaneRouting: mocks.invalidateLaneRouting }));
vi.mock('./makeCoordinator', () => ({ makeSwimlaneCoordinator: () => ({ enterLaneForTask: mocks.enterLaneForTask }) }));
vi.mock('./laneCoordinatorAdmission', () => ({ admitStageEntry: mocks.admitStageEntry, recordStageRefusal: mocks.recordStageRefusal }));

import { tryCoordinatorLaneEntry } from './laneCoordinatorEntry';
import { TicketRunNotFoundError } from './SwimlaneCoordinator';

const env = {} as Env;
const runtime = {} as RuntimeService;
const args = { tenantId: 1, projectId: 11, taskId: 169, status: 'in_progress', submittedBy: 'system:auto-exec' };

const lane = (key: string, over: Record<string, unknown> = {}) => ({
  id: `id-${key}`, key, gate: 'auto', isTerminal: false, successPolicy: 'all', successThreshold: null,
  actionType: null, executionMode: 'sequential', runtimes: ['cloud', 'cloud'], ...over,
});
const routing = (over: Record<string, unknown> = {}) => ({
  tenantId: 1, boardId: 'board-1', lifecycleManaged: false,
  lanes: [lane('in_progress'), lane('in_review', { gate: 'human' }), lane('simple', { runtimes: ['cloud'] })],
  ...over,
});

/** A db whose tasks read answers `liveStatus` (null = row gone). */
function dbWithLiveStatus(liveStatus: string | null): Db {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (liveStatus == null ? [] : [{ status: liveStatus }]) }) }) }),
  } as unknown as Db;
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.invalidateLaneRouting.mockResolvedValue(undefined);
  mocks.recordStageRefusal.mockResolvedValue(undefined);
  mocks.readLaneRouting.mockResolvedValue(routing());
  mocks.admitStageEntry.mockResolvedValue({ admitted: true });
  mocks.enterLaneForTask.mockResolvedValue({ id: 'run-1' });
});

describe('tryCoordinatorLaneEntry', () => {
  it('enters the stage for the live lane when the caller status is current', async () => {
    const out = await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, args);
    expect(out).toBe('started');
    expect(mocks.enterLaneForTask).toHaveBeenCalledWith('board-1', 169, 1, 'in_progress');
  });

  it('regression: a stale snapshot status never moves the run back — the live human-gated lane is not entered', async () => {
    // The sweep read `in_progress`; the ticket has since advanced into the human-gated `in_review`.
    const out = await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_review'), runtime, args);
    expect(out).toBe('not_applicable');
    expect(mocks.enterLaneForTask).not.toHaveBeenCalled();
    expect(mocks.admitStageEntry).not.toHaveBeenCalled();
  });

  it('routes on the LIVE lane when it differs, never the snapshot', async () => {
    mocks.readLaneRouting.mockResolvedValue(routing({ lanes: [lane('in_progress'), lane('qa')] }));
    await tryCoordinatorLaneEntry(env, dbWithLiveStatus('qa'), runtime, args);
    expect(mocks.enterLaneForTask).toHaveBeenCalledWith('board-1', 169, 1, 'qa');
  });

  it('falls back to the caller status when the live read fails or the row is gone', async () => {
    await tryCoordinatorLaneEntry(env, dbWithLiveStatus(null), runtime, args);
    expect(mocks.enterLaneForTask).toHaveBeenCalledWith('board-1', 169, 1, 'in_progress');
  });

  it('is not applicable on a lifecycle-managed board — the manager owns its state machine', async () => {
    mocks.readLaneRouting.mockResolvedValue(routing({ lifecycleManaged: true }));
    expect(await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, args)).toBe('not_applicable');
    expect(mocks.enterLaneForTask).not.toHaveBeenCalled();
  });

  it('is not applicable for a lane the one-agent engine expresses', async () => {
    expect(await tryCoordinatorLaneEntry(env, dbWithLiveStatus('simple'), runtime, args)).toBe('not_applicable');
  });

  it('a refused admission records the refusal, tells onBlocked and never enters the stage', async () => {
    const verdict = { admitted: false, reason: 'run_cap_exhausted' };
    mocks.admitStageEntry.mockResolvedValue(verdict);
    const onBlocked = vi.fn();

    const out = await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, { ...args, onBlocked });

    expect(out).toBe('refused');
    expect(mocks.enterLaneForTask).not.toHaveBeenCalled();
    expect(mocks.recordStageRefusal).toHaveBeenCalledWith(
      env, expect.anything(),
      expect.objectContaining({ taskId: 169, lane: 'in_progress', submittedBy: 'system:auto-exec', onBlocked }),
      verdict,
    );
  });

  it('carries force and the token verdict into admission', async () => {
    const tenantTokens = { hasTokens: true } as never;
    await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, { ...args, force: true, tenantTokens });
    expect(mocks.admitStageEntry).toHaveBeenCalledWith(env, expect.anything(), runtime, expect.objectContaining({ boardId: 'board-1', force: true, tenantTokens }));
  });

  it('a vanished board (TicketRunNotFoundError) invalidates the routing cache and falls back to the one-agent engine', async () => {
    mocks.enterLaneForTask.mockRejectedValue(new TicketRunNotFoundError());
    const out = await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, args);
    expect(out).toBe('not_applicable');
    expect(mocks.invalidateLaneRouting).toHaveBeenCalledWith(env, 1, 11);
  });

  it('any other coordinator error is a refusal, never a throw', async () => {
    mocks.enterLaneForTask.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await tryCoordinatorLaneEntry(env, dbWithLiveStatus('in_progress'), runtime, args)).toBe('refused');
    errorSpy.mockRestore();
  });
});
