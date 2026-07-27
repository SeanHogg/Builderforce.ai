import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyRemedy, type TriageTask, type TriagePolicy } from './triageStage';
import { evaluateTaskAutoRun } from '../swimlane/evaluateAutoRun';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { driveOutstandingSignoffs } from '../kanban/driveSignoffs';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * WHAT each remedy actually calls, and with what.
 *
 * The regression this file exists for: `reset_breaker` — the remedy whose entire job is
 * "allow ONE fresh attempt past the failure breaker" — called `dispatchCloudRunForTask`
 * WITHOUT `force`, and that function enforces the very breaker being reset. Every reset
 * returned null, `applied` stayed false, the attempt counter never left zero, and the
 * escalation ceiling that hands a ticket to a human was therefore unreachable. Measured:
 * 11 tickets halted 25+ days at "0 of 3 tries", none escalated. Nothing in the aggregate
 * counters `runStallTriage` returns can catch that, which is why the assertion is here.
 */

vi.mock('../swimlane/evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('../swimlane/laneEntryTrigger', () => ({ maybeAutoRunOnLaneEntry: vi.fn() }));
vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));
vi.mock('../kanban/driveSignoffs', () => ({ driveOutstandingSignoffs: vi.fn() }));

const mockEvaluate = vi.mocked(evaluateTaskAutoRun);
const mockLaneEntry = vi.mocked(maybeAutoRunOnLaneEntry);
const mockDispatch = vi.mocked(dispatchCloudRunForTask);
const mockDrive = vi.mocked(driveOutstandingSignoffs);

const env = {} as Env;
const db = {} as Db;
const runtime = {} as RuntimeService;

const task: TriageTask = {
  id: 169, title: 'Epic: Code Analysis', description: null, status: 'in_progress',
  createdAt: new Date('2026-07-01T00:00:00Z'), taskType: 'epic', actionType: null,
  gitBranch: 'builderforce/task-169', githubPrUrl: null,
  assignedUserId: null, assignedAgentRef: 'agent-cto', assignedAgentHostId: null,
};

const policy: TriagePolicy = {
  requireSignoffToComplete: true, prMergePolicy: 'immediate', allowAutoMerge: false,
  autoAssign: true, managerRef: 'mgr',
};

const run = (remedy: string, over: Partial<Parameters<typeof applyRemedy>[3]> = {}) =>
  applyRemedy(env, db, runtime, {
    tenantId: 1, projectId: 11, task, policy, remedy, signoff: null, prRow: null,
    mayStartRun: true, mayRaceExecutor: false, ...over,
  });

beforeEach(() => {
  mockEvaluate.mockReset();
  mockLaneEntry.mockReset();
  mockDispatch.mockReset();
  mockDrive.mockReset();
  mockEvaluate.mockResolvedValue({ candidate: { agentRef: 'agent-cto' }, liveExecution: null } as never);
  mockDispatch.mockResolvedValue(4813);
});

describe('applyRemedy — reset_breaker', () => {
  it('FORCES the dispatch, or it is refused by the breaker it is resetting', async () => {
    const result = await run('reset_breaker');

    expect(mockDispatch).toHaveBeenCalledWith(env, db, runtime, expect.any(Function), expect.objectContaining({
      taskId: 169, tenantId: 1, force: true,
    }));
    expect(result).toMatchObject({ applied: true, startedRun: true });
  });

  it('dispatches the SAME candidate the evaluator resolved, with its pinned model', async () => {
    mockEvaluate.mockResolvedValue({ candidate: { agentRef: 'agent-dev', model: 'claude-opus-5' }, liveExecution: null } as never);

    await run('reset_breaker');

    const payload = JSON.parse(mockDispatch.mock.calls[0]![4].payload!);
    expect(payload).toMatchObject({ cloudAgentRef: 'agent-dev', model: 'claude-opus-5', laneKey: 'in_progress' });
  });

  it('preserves the managed role attribution the execution guard requires', async () => {
    mockEvaluate.mockResolvedValue({
      candidate: { agentRef: 'agent-dev', model: 'claude-opus-5' },
      managedRole: {
        roleKey: 'developer',
        agentRef: 'agent-dev',
        source: 'manifest',
        authorizedRoleKeys: ['developer'],
      },
      liveExecution: null,
    } as never);

    await run('reset_breaker');

    const payload = JSON.parse(mockDispatch.mock.calls[0]![4].payload!);
    expect(payload).toMatchObject({
      cloudAgentRef: 'agent-dev',
      actAsRole: 'developer',
      laneKey: 'in_progress',
    });
  });

  it('reports NOT applied when the dispatcher still refuses — the attempt did not happen', async () => {
    mockDispatch.mockResolvedValue(null);
    expect(await run('reset_breaker')).toMatchObject({ applied: false, startedRun: false });
  });

  it('does nothing when a run is already live or no candidate resolves', async () => {
    mockEvaluate.mockResolvedValue({ candidate: { agentRef: 'a' }, liveExecution: { id: 5 } } as never);
    expect(await run('reset_breaker')).toMatchObject({ applied: false });

    mockEvaluate.mockResolvedValue({ candidate: null, liveExecution: null } as never);
    expect(await run('reset_breaker')).toMatchObject({ applied: false });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('never starts a run when the billable budget is spent', async () => {
    expect(await run('reset_breaker', { mayStartRun: false })).toMatchObject({ applied: false });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('applyRemedy — drive_signoff', () => {
  const gate = { satisfied: false, reason: 'outstanding_signoffs', requiredCount: 10, satisfiedCount: 0, outstanding: [], detail: '' } as never;

  it('counts as applied ONLY when a role was actually asked', async () => {
    mockDrive.mockResolvedValue({ asked: ['Architect'], ownership: { dispatchable: [], humanOwed: [], unstaffed: [] }, dispatchable: true, blockedDetail: '' });
    expect(await run('drive_signoff', { signoff: gate })).toMatchObject({ applied: true, startedRun: true });
  });

  /** A refused dispatch must not advance the attempt counter — it never happened. */
  it('reports the blocker, not an attempt, when nothing was asked', async () => {
    mockDrive.mockResolvedValue({
      asked: [], ownership: { dispatchable: [], humanOwed: [], unstaffed: [] }, dispatchable: true,
      blockedDetail: 'The dispatcher refused to start Architect\'s review',
    });
    const result = await run('drive_signoff', { signoff: gate });
    expect(result).toMatchObject({ applied: false, startedRun: false });
    expect(result.note).toContain('refused');
  });

  it('is inert without a resolved gate', async () => {
    expect(await run('drive_signoff', { signoff: null })).toMatchObject({ applied: false });
    expect(mockDrive).not.toHaveBeenCalled();
  });
});

describe('applyRemedy — the executor-owned remedies stay behind their flags', () => {
  it('dispatch runs the lane trigger only when a run is permitted', async () => {
    mockLaneEntry.mockResolvedValue(true);
    expect(await run('dispatch')).toMatchObject({ applied: true, startedRun: true });

    mockLaneEntry.mockClear();
    expect(await run('dispatch', { mayStartRun: false })).toMatchObject({ applied: false });
    expect(mockLaneEntry).not.toHaveBeenCalled();
  });

  it('resolve_conflict needs an agent on the ticket', async () => {
    mockLaneEntry.mockResolvedValue(true);
    const ownerless = { ...task, assignedAgentRef: null, assignedAgentHostId: null };
    expect(await run('resolve_conflict', { task: ownerless })).toMatchObject({ applied: false });
    expect(mockLaneEntry).not.toHaveBeenCalled();
  });
});
