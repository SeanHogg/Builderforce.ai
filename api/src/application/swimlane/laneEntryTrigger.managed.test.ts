import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maybeAutoRunOnLaneEntry } from './laneEntryTrigger';
import { enforceLaneRequirements } from './laneRequirementGate';
import { evaluateTaskAutoRun } from './evaluateAutoRun';
import { requestRoleRun } from '../kanban/requestRoleRun';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { parseActAsRole } from '../runtime/cloudDispatch';
import { evaluateExecutionApprovalGate } from '../runtime/executionApprovalGate';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * THE DISPATCH LIMB — which, until now, no test had ever executed.
 *
 * The one existing trigger test (`laneEntryTrigger.force.test.ts`) deliberately stubs
 * `canRunNow: false` to keep the trigger from proceeding past the gate, and mocks the
 * dispatcher to a no-op. So the code path that actually starts runs — and the payload it
 * builds — was unasserted, which is how a managed board ended up unable to dispatch
 * anything at all for weeks while every unit test passed.
 */

vi.mock('./laneRequirementGate', () => ({ enforceLaneRequirements: vi.fn() }));
vi.mock('./evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('../audit/ticketAuditService', () => ({ TicketAuditService: class {} }));
vi.mock('../kanban/ticketParticipants', () => ({ TicketParticipantsService: class {} }));
vi.mock('../kanban/requestRoleRun', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requestRoleRun: vi.fn(),
}));
vi.mock('../runtime/cloudAgentEngine', () => ({ recordCloudToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtime/autoRunSkipLedger', () => ({
  autoRunSkipState: (lane: string, reason: string) => `${lane}|${reason}`,
  claimAutoRunSkipState: vi.fn().mockResolvedValue(true),
  clearAutoRunSkip: vi.fn().mockResolvedValue(undefined),
  emitAutoRunSkip: vi.fn().mockResolvedValue(undefined),
  recordAutoRunSkip: vi.fn().mockResolvedValue(true),
}));
vi.mock('../runtime/cronWorkSignal', () => ({ signalPendingWork: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtime/executionApprovalGate', () => ({ evaluateExecutionApprovalGate: vi.fn() }));
vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));

const mockGate = vi.mocked(enforceLaneRequirements);
const mockEval = vi.mocked(evaluateTaskAutoRun);
const mockRoleRun = vi.mocked(requestRoleRun);
const mockDispatch = vi.mocked(dispatchCloudRunForTask);
const mockApproval = vi.mocked(evaluateExecutionApprovalGate);

const env = {} as Env;
const runtime = {} as RuntimeService;

/** One task row for the approval-gate lookup. */
const db = {
  select: () => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit']) self[m] = () => self;
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve([{ id: 1032, title: 'Platform finding', priority: 'high', projectId: 11, assignedAgentHostId: null }]).then(resolve);
    return self;
  },
} as unknown as Db;

const evaluation = (over: Record<string, unknown>) => ({
  status: 'todo', assignedAgentRef: null, laneResolved: true, isTerminalLane: false,
  laneGate: 'auto', staffedAgentRefs: ['lane-agent'], decision: { autoRun: true, agentRef: 'bob-dev' },
  candidate: { agentRef: 'bob-dev' }, liveExecution: null, canRunNow: true, reason: 'will_run',
  cooldownRemainingMs: 0, consecutiveFailures: 0, failureBreakerAt: 3, tenantTokens: null,
  lifecycleManaged: false, managedRole: null,
  ...over,
});

const enter = () => maybeAutoRunOnLaneEntry(env, db, runtime, {
  tenantId: 1, projectId: 11, taskId: 1032, status: 'todo', submittedBy: 'system:lane-auto',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue({ blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] });
  mockApproval.mockResolvedValue({ allowed: true } as never);
  mockRoleRun.mockResolvedValue({ executionId: 4711 });
  mockDispatch.mockResolvedValue({ executionId: 4711 });
});

describe('maybeAutoRunOnLaneEntry — a lifecycle-managed board', () => {
  it('dispatches through requestRoleRun AS the role, never through the bare dispatcher', async () => {
    mockEval.mockResolvedValue(evaluation({
      lifecycleManaged: true,
      managedRole: { roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest', authorizedRoleKeys: ['developer'] },
    }) as never);

    const started = await enter();

    expect(started).toBe(true);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRoleRun).toHaveBeenCalledWith(env, db, runtime, expect.anything(), expect.objectContaining({
      taskId: 1032, roleKey: 'developer', agentRef: 'bob-dev', kind: 'producer', laneKey: 'todo',
    }));
  });

  // The approval gate persists the payload so a manager's later approval replays THIS
  // run. Handing it the bare payload while dispatching a role-attributed one would
  // approve a different run than the one that executes.
  it('gates on the ROLE-ATTRIBUTED payload, so an approval replays the run that will actually go out', async () => {
    mockEval.mockResolvedValue(evaluation({
      lifecycleManaged: true,
      managedRole: { roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest', authorizedRoleKeys: ['developer'] },
    }) as never);

    await enter();

    const gated = mockApproval.mock.calls[0]?.[5] as { payload?: string };
    expect(parseActAsRole(gated.payload)).toBe('developer');
  });

  // A refusal is not a dispatch. `requestRoleRun` returns null when the dispatcher
  // declines (cap, breaker, cooldown) and has already recorded it.
  it('reports NOT started when the role dispatch is refused', async () => {
    mockEval.mockResolvedValue(evaluation({
      lifecycleManaged: true,
      managedRole: { roleKey: 'developer', agentRef: 'bob-dev', source: 'manifest', authorizedRoleKeys: ['developer'] },
    }) as never);
    mockRoleRun.mockResolvedValue({ executionId: null, refusal: { reason: 'cooldown_active', message: 'backing off' } });

    expect(await enter()).toBe(false);
  });

  it('starts NOTHING when no role resolves — and never falls back to a payload the guard refuses', async () => {
    mockEval.mockResolvedValue(evaluation({
      canRunNow: false, reason: 'managed_no_role', lifecycleManaged: true, managedRole: null,
      decision: { autoRun: false }, candidate: null,
    }) as never);

    expect(await enter()).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRoleRun).not.toHaveBeenCalled();
  });

  it('leaves an UNMANAGED board on the bare dispatcher — no regression for the 10-of-11 boards', async () => {
    mockEval.mockResolvedValue(evaluation({}) as never);

    expect(await enter()).toBe(true);
    expect(mockRoleRun).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const payload = (mockDispatch.mock.calls[0]?.[4] as { payload?: string }).payload;
    expect(parseActAsRole(payload)).toBeUndefined();
  });
});
