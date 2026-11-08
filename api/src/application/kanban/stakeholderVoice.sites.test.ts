import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One test per ticket-scoped stakeholder site that routes through `resolveStakeholderVoice`
 * (PRD 37 §5.5): the milestone line in the linked chat, the approval gate, the raised
 * approval, and the incident war-room note. The seam itself is covered in
 * stakeholderVoice.test.ts.
 */

const resolveStakeholderVoice = vi.fn(async (_db: unknown, a: { actingLabel: string }) => `Dana (on behalf of ${a.actingLabel})`);
vi.mock('./stakeholderVoice', () => ({ resolveStakeholderVoice: (...a: unknown[]) => resolveStakeholderVoice(...(a as [unknown, { actingLabel: string }])) }));

const postSystemMessage = vi.fn(async () => undefined);
vi.mock('../brain/chatSystemMessage', () => ({ postSystemMessage: (...a: unknown[]) => postSystemMessage(...(a as [])) }));
vi.mock('../brain/ticketChatLineage', () => ({
  listChatsForTicket: async () => [{ chatId: 5, isArchived: false, mergedIntoChatId: null }],
}));
vi.mock('../brain/chatAgents', () => ({ joinAgentToChat: async () => undefined }));
vi.mock('../brain/agentDisplayNames', () => ({ resolveAgentDisplayName: async () => 'Builder Bot' }));

vi.mock('../approval/approvalNotifier', () => ({
  notifyApprovalRequested: async () => undefined,
  notifyRequesterOfOwnApproval: async () => undefined,
}));
vi.mock('../approval/autoApprovalRules', () => ({ checkAutoApprovalRules: async () => false }));

import { postRunMilestone } from '../brain/chatRunMilestones';
import { resolveApprovalGate } from '../approval/approvalGate';
import { requestApproval } from '../approval/requestApproval';
import { resolveIncidentVoice } from '../incident/incidentVoice';

beforeEach(() => vi.clearAllMocks());

/** Awaitable, chainable select returning `rows`; insert captures the values written. */
function fakeDb(selectRows: unknown[][], inserted: Array<Record<string, unknown>> = []) {
  const queue = [...selectRows];
  const chain = () => {
    const rows = queue.shift() ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return b;
  };
  return {
    select: chain,
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
  } as never;
}

describe('postRunMilestone', () => {
  it('speaks as the Coordinator on behalf of the running agent for a task ticket', async () => {
    await postRunMilestone({ db: {} as never, env: {} as never } as never, 1, { kind: 'task', ref: '42', phase: 'started', executionId: 7, agentRef: 'a1' });
    expect(resolveStakeholderVoice).toHaveBeenCalledWith(expect.anything(), { tenantId: 1, taskId: 42, actingLabel: 'Builder Bot' });
    const calls = postSystemMessage.mock.calls as unknown as unknown[][];
    expect(String(calls[0]![4])).toContain('Dana (on behalf of Builder Bot)');
  });

  it('does not look up a Coordinator for a non-task tier', async () => {
    await postRunMilestone({ db: {} as never, env: {} as never } as never, 1, { kind: 'retro', ref: 'uuid-1', phase: 'started', executionId: 7, agentRef: 'a1' });
    expect(resolveStakeholderVoice).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: null }));
  });
});

describe('resolveApprovalGate', () => {
  it('voices the requester of a taskId-scoped approval', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    await resolveApprovalGate(fakeDb([[]], inserted), {
      tenantId: 1, actionType: 'task.execution', subjectKey: 'taskId', subjectId: 42,
      pendingReason: 'p', openedReason: 'o',
      draft: () => ({ description: 'd', requestedBy: 'Builder Bot' }),
    });
    expect(inserted[0]!.requestedBy).toBe('Dana (on behalf of Builder Bot)');
  });

  it('leaves a non-task subject (workflow run) alone', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    await resolveApprovalGate(fakeDb([[]], inserted), {
      tenantId: 1, actionType: 'workflow.run', subjectKey: 'workflowDefinitionId', subjectId: 'wf-1',
      pendingReason: 'p', openedReason: 'o',
      draft: () => ({ description: 'd', requestedBy: 'u:3' }),
    });
    expect(resolveStakeholderVoice).not.toHaveBeenCalled();
    expect(inserted[0]!.requestedBy).toBe('u:3');
  });
});

describe('requestApproval', () => {
  it('voices the requester of an approval that names a ticket', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    await requestApproval(fakeDb([[]], inserted), {} as never, {
      tenantId: 1, agentHostId: null, callerUserId: 'u1', requestedBy: 'Builder Bot',
      kind: 'approval', actionType: 'deploy.prod', description: 'Ship it', metadata: { taskId: 42 },
    });
    expect(resolveStakeholderVoice).toHaveBeenCalledWith(expect.anything(), { tenantId: 1, taskId: 42, actingLabel: 'Builder Bot' });
    expect(inserted[0]!.requestedBy).toBe('Dana (on behalf of Builder Bot)');
  });

  it('keeps the label when the approval names no ticket', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    await requestApproval(fakeDb([[]], inserted), {} as never, {
      tenantId: 1, agentHostId: null, callerUserId: 'u1', requestedBy: 'Builder Bot',
      kind: 'approval', actionType: 'deploy.prod', description: 'Ship it', metadata: {},
    });
    expect(resolveStakeholderVoice).not.toHaveBeenCalled();
    expect(inserted[0]!.requestedBy).toBe('Builder Bot');
  });
});

describe('resolveIncidentVoice', () => {
  it('voices a note on an incident bridged to a ticket', async () => {
    await expect(resolveIncidentVoice(fakeDb([[{ boardTaskId: 42 }]]), { tenantId: 1, incidentId: 'inc-1', actingLabel: 'agent' }))
      .resolves.toBe('Dana (on behalf of agent)');
    expect(resolveStakeholderVoice).toHaveBeenCalledWith(expect.anything(), { tenantId: 1, taskId: 42, actingLabel: 'agent' });
  });

  it('passes no ticket for an unbridged incident', async () => {
    await resolveIncidentVoice(fakeDb([[{ boardTaskId: null }]]), { tenantId: 1, incidentId: 'inc-1', actingLabel: 'agent' });
    expect(resolveStakeholderVoice).toHaveBeenCalledWith(expect.anything(), { tenantId: 1, taskId: null, actingLabel: 'agent' });
  });
});
