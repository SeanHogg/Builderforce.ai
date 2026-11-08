/**
 * A late steer whose follow-up is refused by ADMISSION (a live run on the ticket, the
 * concurrent cap) is DEFERRED - released back to pending for the next chokepoint - not dropped.
 * A billing entitlement refusal still drops visibly.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./followUpRun', () => ({ startFollowUpRun: vi.fn() }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn() }));
vi.mock('./cloudAgent/agent', () => ({ resolveCloudAgent: vi.fn() }));

import { dispatchLateSteerFollowUp, type LateSteerPorts } from './lateSteerFollowUp';
import type { FollowUpRunOutcome } from './followUpRun';

function ports(followUp: FollowUpRunOutcome, withRelease = true) {
  const release = vi.fn(async () => undefined);
  const recordOutcome = vi.fn(async () => undefined);
  const timeline = vi.fn(async () => undefined);
  const p: LateSteerPorts = {
    loadExecution: async () => ({
      id: 42, tenantId: 7, status: 'completed', taskId: 11, payload: '{}', agentHostId: null, source: 'agent',
      cloudAgentRef: 'bob', submittedBy: 'user:ada',
    }),
    loadTask: async () => ({ id: 11, title: 'T', description: null, assignedAgentHostId: null, assignedAgentRef: 'bob', assignedUserId: null, priority: 'medium', projectId: 3 }),
    repend: async () => undefined,
    claim: async () => [{ id: 1, text: 'more please', sentBy: 'ada' }],
    priorOutcome: async () => null,
    recordOutcome,
    agentLabel: async () => 'Bob',
    startFollowUp: async () => followUp,
    timeline,
    ...(withRelease ? { release } : {}),
  };
  return { p, release, recordOutcome, timeline };
}

const admission = { code: 'concurrent_run_limit', limit: 2, current: 2, effectivePlan: 'free', message: 'cap' } as const;

describe('late steer follow-up under admission', () => {
  it('regression: a concurrent-cap refusal keeps the steer pending (released, not dropped)', async () => {
    const w = ports({ kind: 'refused', reason: 'concurrent_run_limit', message: 'cap', admission });
    const out = await dispatchLateSteerFollowUp(w.p, { executionId: 42, tenantId: 7, reason: 'run_ended' });
    expect(out).toEqual({ kind: 'deferred' });
    expect(w.release).toHaveBeenCalledWith(7, 42, [1]);
    expect(w.recordOutcome).not.toHaveBeenCalled(); // no `steer.dropped`
    expect(w.timeline).not.toHaveBeenCalled();
  });

  it('a billing entitlement refusal still drops visibly', async () => {
    const w = ports({ kind: 'refused', reason: 'tenant_token_limit', message: 'no tokens' });
    const out = await dispatchLateSteerFollowUp(w.p, { executionId: 42, tenantId: 7, reason: 'run_ended' });
    expect(out).toMatchObject({ kind: 'refused', reason: 'tenant_token_limit' });
    expect(w.release).not.toHaveBeenCalled();
    expect(w.recordOutcome).toHaveBeenCalled();
  });
});
