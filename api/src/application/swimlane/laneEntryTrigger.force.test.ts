import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maybeAutoRunOnLaneEntry } from './laneEntryTrigger';
import { enforceLaneRequirements } from './laneRequirementGate';
import { evaluateTaskAutoRun } from './evaluateAutoRun';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * The middle link of the human override: trigger → requirement gate.
 *
 * `force` exists so a manager's "Dispatch reviewers" click can ask a role on a ticket
 * whose failure breaker has tripped — the case the button exists for and the one where it
 * used to do nothing. It must reach the GATE (which dispatches the roles) and must NOT be
 * invented by an autonomous lane entry, because the breaker is what stops autonomy
 * re-asking a failing ticket forever. Both directions are asserted; a pass-through this
 * thin is exactly what a refactor drops silently.
 */

vi.mock('./laneRequirementGate', () => ({ enforceLaneRequirements: vi.fn() }));
vi.mock('./evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('../audit/ticketAuditService', () => ({ TicketAuditService: class {} }));
vi.mock('../runtime/cloudAgentEngine', () => ({ recordCloudToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));

const mockGate = vi.mocked(enforceLaneRequirements);
const env = {} as Env;
const db = {} as Db;
const runtime = {} as RuntimeService;

const enter = (force?: boolean) => maybeAutoRunOnLaneEntry(env, db, runtime, {
  tenantId: 1, projectId: 11, taskId: 169, status: 'requirements', submittedBy: 'test',
  ...(force ? { force: true } : {}),
});

beforeEach(() => {
  mockGate.mockReset();
  mockGate.mockResolvedValue({ blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] });
  // The evaluator answering `no_agent` keeps the trigger from proceeding past the gate
  // into dispatch — the gate call itself is what this file is about.
  vi.mocked(evaluateTaskAutoRun).mockResolvedValue({
    status: 'requirements', assignedAgentRef: null, laneResolved: true, isTerminalLane: false,
    laneGate: 'auto', staffedAgentRefs: [], decision: { autoRun: false }, candidate: null,
    liveExecution: null, canRunNow: false, reason: 'no_agent', cooldownRemainingMs: 0,
    consecutiveFailures: 0, failureBreakerAt: 3, tenantTokens: null,
  } as never);
});

describe('maybeAutoRunOnLaneEntry — force reaches the requirement gate', () => {
  it('hands the override to the gate, which is what reaches the role dispatch', async () => {
    await enter(true);

    expect(mockGate).toHaveBeenCalledWith(env, db, runtime, expect.anything(), expect.objectContaining({
      taskId: 169, status: 'requirements', force: true,
    }));
  });

  it('leaves it unset for an autonomous lane entry', async () => {
    await enter();

    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(mockGate.mock.calls[0]![4]).not.toHaveProperty('force');
  });
});
