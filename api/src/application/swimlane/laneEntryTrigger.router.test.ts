import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeLaneEntry } from './laneEntryTrigger';
import { enforceLaneRequirements } from './laneRequirementGate';
import { evaluateTaskAutoRun } from './evaluateAutoRun';
import { tryCoordinatorLaneEntry } from './laneCoordinatorEntry';
import { findCanonicalBoard } from './canonicalBoard';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * routeLaneEntry is the ONE door into a lane. Callers that used to enter the one-agent engine
 * directly (the ceremony, the challenge build, the sweeps, the manager's own state machine, the
 * runtime's lane chaining) now come through it, so this pins what they rely on:
 *   - a caller with NO `onManagedBoard` never reaches the manager (the state machine cannot recurse),
 *     even on a lifecycle-managed board;
 *   - the dispatch options (`force`, `onBlocked`, `signalCronGate`, `tenantTokens`) survive the hop;
 *   - a lane that needs the coordinator goes there instead of the one-agent engine.
 */

vi.mock('./laneRequirementGate', () => ({ enforceLaneRequirements: vi.fn() }));
vi.mock('./evaluateAutoRun', () => ({ evaluateTaskAutoRun: vi.fn() }));
vi.mock('./laneCoordinatorEntry', () => ({ tryCoordinatorLaneEntry: vi.fn() }));
vi.mock('./canonicalBoard', () => ({ findCanonicalBoard: vi.fn() }));
vi.mock('../runtime/cronWorkSignal', () => ({ signalPendingWork: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../audit/ticketAuditService', () => ({ TicketAuditService: class {} }));
vi.mock('../runtime/cloudAgentEngine', () => ({ recordCloudToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../runtime/dispatchCloudRun', () => ({ dispatchCloudRunForTask: vi.fn() }));

const env = {} as Env;
const db = {} as Db;
const runtime = {} as RuntimeService;
const base = { tenantId: 1, projectId: 11, taskId: 169, status: 'requirements', submittedBy: 'test' };

beforeEach(() => {
  vi.mocked(enforceLaneRequirements).mockReset();
  vi.mocked(enforceLaneRequirements).mockResolvedValue({ blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] });
  vi.mocked(tryCoordinatorLaneEntry).mockReset();
  vi.mocked(tryCoordinatorLaneEntry).mockResolvedValue('not_applicable');
  vi.mocked(findCanonicalBoard).mockReset();
  vi.mocked(findCanonicalBoard).mockResolvedValue({ id: 1, lifecycleManaged: true } as never);
  vi.mocked(evaluateTaskAutoRun).mockReset();
  vi.mocked(evaluateTaskAutoRun).mockResolvedValue({
    status: 'requirements', assignedAgentRef: null, laneResolved: true, isTerminalLane: false,
    laneGate: 'auto', staffedAgentRefs: [], decision: { autoRun: false }, candidate: null,
    liveExecution: null, canRunNow: false, reason: 'no_agent', cooldownRemainingMs: 0,
    consecutiveFailures: 0, failureBreakerAt: 3, tenantTokens: null,
  } as never);
});

describe('routeLaneEntry', () => {
  it('never calls the manager when the caller supplies no onManagedBoard, even on a managed board', async () => {
    await routeLaneEntry(env, db, runtime, base);

    // The managed branch is skipped without even reading the board for it.
    expect(findCanonicalBoard).not.toHaveBeenCalled();
    expect(tryCoordinatorLaneEntry).toHaveBeenCalledTimes(1);
    expect(evaluateTaskAutoRun).toHaveBeenCalledTimes(1);
  });

  it('hands a managed board to onManagedBoard when the caller supplies one', async () => {
    const onManagedBoard = vi.fn().mockResolvedValue(undefined);

    const res = await routeLaneEntry(env, db, runtime, { ...base, onManagedBoard });

    expect(res).toBe(true);
    expect(onManagedBoard).toHaveBeenCalledTimes(1);
    expect(tryCoordinatorLaneEntry).not.toHaveBeenCalled();
  });

  it('carries force, onBlocked and signalCronGate through to the one-agent engine', async () => {
    const onBlocked = vi.fn();

    await routeLaneEntry(env, db, runtime, { ...base, force: true, onBlocked, signalCronGate: false });

    expect(enforceLaneRequirements).toHaveBeenCalledWith(env, db, runtime, expect.anything(), expect.objectContaining({ force: true }));
    expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_agent' }));
  });

  it('drives a lane that needs the coordinator through it, not through the one-agent engine', async () => {
    vi.mocked(tryCoordinatorLaneEntry).mockResolvedValue('started');

    const res = await routeLaneEntry(env, db, runtime, base);

    expect(res).toBe(true);
    expect(evaluateTaskAutoRun).not.toHaveBeenCalled();
  });

  it('hands the coordinator the same dispatch options the one-agent engine honours (force, tokens, onBlocked, submitter)', async () => {
    vi.mocked(tryCoordinatorLaneEntry).mockResolvedValue('refused');
    const onBlocked = vi.fn();
    const tenantTokens = { hasTokens: true } as never;

    await routeLaneEntry(env, db, runtime, { ...base, force: true, onBlocked, tenantTokens });

    expect(tryCoordinatorLaneEntry).toHaveBeenCalledWith(env, db, runtime, expect.objectContaining({
      submittedBy: 'test', force: true, onBlocked, tenantTokens,
    }));
  });

  it('a coordinator that declines is final: it does not fall back to one agent of a refused stage', async () => {
    vi.mocked(tryCoordinatorLaneEntry).mockResolvedValue('refused');

    const res = await routeLaneEntry(env, db, runtime, base);

    expect(res).toBe(false);
    expect(evaluateTaskAutoRun).not.toHaveBeenCalled();
  });

  it('a throwing coordinator read never escapes to the caller', async () => {
    vi.mocked(tryCoordinatorLaneEntry).mockRejectedValue(new Error('db blip'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(routeLaneEntry(env, db, runtime, base)).resolves.toBe(false);

    errorSpy.mockRestore();
  });
});
