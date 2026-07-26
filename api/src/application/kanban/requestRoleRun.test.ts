import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestRoleRun } from './requestRoleRun';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { recordActivity } from '../activity/activityLog';
import type { TicketParticipantsService } from './ticketParticipants';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

vi.mock('../../presentation/routes/runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));
vi.mock('../activity/activityLog', () => ({
  recordActivity: vi.fn().mockResolvedValue(undefined),
  cloudAgentActor: (ref: string, name: string) => ({ ref, name }),
}));

const mockDispatch = vi.mocked(dispatchCloudRunForTask);
const mockActivity = vi.mocked(recordActivity);

const env = {} as Env;
const db = {} as Db;
const runtime = {} as RuntimeService;

function participantsStub() {
  const markRoleInProgress = vi.fn().mockResolvedValue(undefined);
  return { service: { markRoleInProgress } as unknown as TicketParticipantsService, markRoleInProgress };
}

const request = (over: Partial<Parameters<typeof requestRoleRun>[4]> = {}) => ({
  tenantId: 1, projectId: 11, taskId: 169, taskTitle: 'Epic: Code Analysis',
  roleKey: 'architect', roleName: 'Architect', agentRef: 'agent-cto',
  laneKey: 'in_review', kind: 'reviewer' as const,
  submittedBy: 'manager:signoff-request:mgr',
  ...over,
});

beforeEach(() => {
  mockDispatch.mockReset();
  mockActivity.mockClear();
});

describe('requestRoleRun', () => {
  /**
   * The measured bug: the dispatcher RETURNS NULL when it refuses (cloud-run cap,
   * failure breaker, re-run cooldown). Callers that ignored it reported the reviewer as
   * asked and — worse — marked the slot `in_progress`, which is the very state that
   * makes the next pass skip it. One refusal could retire a role permanently.
   */
  it('records NOTHING when the dispatcher refuses the run', async () => {
    mockDispatch.mockResolvedValue(null);
    const { service, markRoleInProgress } = participantsStub();

    const result = await requestRoleRun(env, db, runtime, service, request());

    expect(result).toBeNull();
    expect(markRoleInProgress).not.toHaveBeenCalled();
    expect(mockActivity).not.toHaveBeenCalled();
  });

  it('records NOTHING when the dispatcher throws', async () => {
    mockDispatch.mockRejectedValue(new Error('managed execution is not authorized'));
    const { service, markRoleInProgress } = participantsStub();

    await expect(requestRoleRun(env, db, runtime, service, request())).resolves.toBeNull();
    expect(markRoleInProgress).not.toHaveBeenCalled();
  });

  /** `in_progress` is what `pickSignoffCandidate` reads to move on to the NEXT role. */
  it('marks the slot in_progress against the started execution', async () => {
    mockDispatch.mockResolvedValue(4813);
    const { service, markRoleInProgress } = participantsStub();

    const result = await requestRoleRun(env, db, runtime, service, request());

    expect(result).toBe(4813);
    expect(markRoleInProgress).toHaveBeenCalledWith(env, 1, 169, 'architect', 'in_review', 4813);
    expect(mockActivity).toHaveBeenCalledWith(env, db, expect.objectContaining({
      verb: 'ticket.role.dispatched',
      metadata: expect.objectContaining({ roleKey: 'architect', responsibility: 'reviewer' }),
    }));
  });

  it('sends the REVIEWER contract for a reviewer and the PRODUCER contract for a producer', async () => {
    mockDispatch.mockResolvedValue(1);
    const { service } = participantsStub();

    await requestRoleRun(env, db, runtime, service, request());
    const reviewer = JSON.parse(mockDispatch.mock.calls[0]![4].payload!);
    expect(reviewer).toMatchObject({ reviewRole: 'architect', laneKey: 'in_review', cloudAgentRef: 'agent-cto' });

    await requestRoleRun(env, db, runtime, service, request({ kind: 'producer' }));
    const producer = JSON.parse(mockDispatch.mock.calls[1]![4].payload!);
    expect(producer).toMatchObject({ actAsRole: 'architect' });
    expect(producer.reviewRole).toBeUndefined();
  });

  it('never forces the dispatcher unless the caller asked for the override', async () => {
    mockDispatch.mockResolvedValue(1);
    const { service } = participantsStub();

    await requestRoleRun(env, db, runtime, service, request());
    expect(mockDispatch.mock.calls[0]![4].force).toBeUndefined();

    await requestRoleRun(env, db, runtime, service, request({ force: true }));
    expect(mockDispatch.mock.calls[1]![4].force).toBe(true);
  });
});
