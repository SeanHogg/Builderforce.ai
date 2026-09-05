import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backfillLaneResidents } from './laneResidentBackfill';
import { tryCoordinatorLaneEntry } from './laneCoordinatorEntry';
import { evaluateTaskAutoRun } from './evaluateAutoRun';
import { enforceLaneRequirements } from './laneRequirementGate';
import { evaluateExecutionApprovalGate } from '../runtime/executionApprovalGate';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * ASSIGN -> DISPATCH -> RUN, walked end to end through the real funnel.
 *
 * No test had ever walked this chain, and the hole it left was structural rather than
 * cosmetic: the autonomous trigger is an ENTRY trigger, so staffing an agent onto a lane
 * that ALREADY held tickets started none of them. The board looked configured and was
 * inert, and the only way to start a resident ticket was to drag it out and back in.
 *
 * Only the EDGES are mocked — the evaluator's verdict, the requirement gate, the
 * approval gate and the dispatcher. Everything between (the backfill, the engine choice,
 * the trigger, the payload it builds) is the real code.
 */
vi.mock('./laneCoordinatorEntry', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  tryCoordinatorLaneEntry: vi.fn(),
}));
vi.mock('./evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('./laneRequirementGate', () => ({ enforceLaneRequirements: vi.fn() }));
vi.mock('./laneAgentHost', () => ({ resolveLaneAgentHostId: vi.fn().mockResolvedValue(null) }));
vi.mock('../audit/ticketAuditService', () => ({ TicketAuditService: class {} }));
vi.mock('../kanban/ticketParticipants', () => ({ TicketParticipantsService: class {} }));
vi.mock('../runtime/cloudAgentEngine', () => ({ recordCloudToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtime/autoRunSkipLedger', () => ({
  autoRunSkipState: (lane: string, reason: string) => `${lane}|${reason}`,
  claimAutoRunSkipState: vi.fn().mockResolvedValue(true),
  clearAutoRunSkip: vi.fn().mockResolvedValue(undefined),
  emitAutoRunSkip: vi.fn().mockResolvedValue(undefined),
  recordAutoRunSkip: vi.fn().mockResolvedValue(true),
}));
vi.mock('../runtime/cronWorkSignal', () => ({ signalPendingWork: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtime/executionReadMemo', () => ({ createExecutionReadMemo: () => ({ listByTask: async () => [] }) }));
vi.mock('../runtime/executionApprovalGate', () => ({ evaluateExecutionApprovalGate: vi.fn() }));
vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({} as RuntimeService) }));

const mockCoordinator = vi.mocked(tryCoordinatorLaneEntry);
const mockEval = vi.mocked(evaluateTaskAutoRun);
const mockGate = vi.mocked(enforceLaneRequirements);
const mockApproval = vi.mocked(evaluateExecutionApprovalGate);
const mockDispatch = vi.mocked(dispatchCloudRunForTask);

const env = {} as Env;

/**
 * A fake Drizzle chain that answers by the SHAPE of the query rather than by call order:
 * the backfill reads the board then the residents, and the trigger then reads one task
 * row per ticket for the approval gate.
 */
function makeDb(residents: number[]): Db {
  return {
    select: (cols?: Record<string, unknown>) => {
      const keys = Object.keys(cols ?? {});
      const rows: unknown[] =
        keys.length === 1 && keys[0] === 'projectId' ? [{ projectId: 11 }]
          : keys.length === 1 && keys[0] === 'id' ? residents.map((id) => ({ id }))
            : [{ id: residents[0] ?? 1, title: 'A ticket', priority: 'medium', projectId: 11, assignedAgentHostId: null }];
      const self: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) self[m] = () => self;
      self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
      return self;
    },
  } as unknown as Db;
}

const willRun = (over: Record<string, unknown> = {}) => ({
  status: 'in_progress', assignedAgentRef: null, laneResolved: true, isTerminalLane: false,
  laneGate: 'auto', staffedAgentRefs: ['lane-agent'],
  decision: { autoRun: true, agentRef: 'bob-dev' },
  candidate: { agentRef: 'bob-dev' }, liveExecution: null, canRunNow: true, reason: 'will_run',
  cooldownRemainingMs: 0, consecutiveFailures: 0, failureBreakerAt: 3, tenantTokens: null,
  lifecycleManaged: false, managedRole: null, unfilledRoleKeys: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCoordinator.mockResolvedValue('not_applicable');
  mockGate.mockResolvedValue({ blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] } as never);
  mockApproval.mockResolvedValue({ allowed: true } as never);
  mockEval.mockResolvedValue(willRun() as never);
  mockDispatch.mockResolvedValue({ executionId: 4711 });
});

describe('staffing a lane starts the tickets ALREADY sitting in it', () => {
  it('reaches the DISPATCHER for every resident ticket, as the lane agent', async () => {
    const result = await backfillLaneResidents(env, makeDb([501, 502, 503]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'in_progress', submittedBy: 'system:lane-staffed',
    });

    expect(result).toEqual({ considered: 3, started: 3, skipped: 0 });
    expect(mockDispatch).toHaveBeenCalledTimes(3);
    expect(mockDispatch.mock.calls.map((c) => c[4].taskId)).toEqual([501, 502, 503]);
    // The run is attributed to the LANE's agent and records the lane it serves.
    const payload = JSON.parse(mockDispatch.mock.calls[0]![4].payload as string) as Record<string, unknown>;
    expect(payload).toMatchObject({ cloudAgentRef: 'bob-dev', laneKey: 'in_progress' });
  });

  it('counts a per-ticket REFUSAL as skipped — the breaker and the cap still decide individually', async () => {
    mockEval
      .mockResolvedValueOnce(willRun() as never)
      .mockResolvedValueOnce(willRun({ canRunNow: false, reason: 'run_cap_exhausted' }) as never);

    const result = await backfillLaneResidents(env, makeDb([501, 502]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'in_progress', submittedBy: 'u1',
    });

    expect(result).toEqual({ considered: 2, started: 1, skipped: 1 });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('holds a ticket the APPROVAL GATE refuses instead of dispatching it', async () => {
    mockApproval.mockResolvedValue({ allowed: false, reason: 'high_priority', approvalId: 7 } as never);

    const result = await backfillLaneResidents(env, makeDb([501]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'in_progress', submittedBy: 'u1',
    });

    expect(result).toEqual({ considered: 1, started: 0, skipped: 1 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('routes a STAGED lane through the coordinator, and never ALSO through the one-agent path', async () => {
    mockCoordinator.mockResolvedValue('started');

    const result = await backfillLaneResidents(env, makeDb([501]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'in_review', submittedBy: 'u1',
    });

    expect(result.started).toBe(1);
    expect(mockCoordinator).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does NOT fall back to the simple executor when the coordinator REFUSED the stage', async () => {
    mockCoordinator.mockResolvedValue('refused');

    const result = await backfillLaneResidents(env, makeDb([501]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'in_review', submittedBy: 'u1',
    });

    expect(result).toEqual({ considered: 1, started: 0, skipped: 1 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('is a no-op on an empty lane', async () => {
    expect(await backfillLaneResidents(env, makeDb([]), {
      tenantId: 1, boardId: 'board-1', laneKey: 'todo', submittedBy: 'u1',
    })).toEqual({ considered: 0, started: 0, skipped: 0 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
