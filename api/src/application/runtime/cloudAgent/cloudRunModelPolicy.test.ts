import { describe, expect, it, vi } from 'vitest';
import { MAX_ANNOUNCEMENT_RECOVERIES } from '@builderforce/agent-stall';

const { recordCloudToolEvent } = vi.hoisted(() => ({ recordCloudToolEvent: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent }));

import {
  cloudRunPolicyRole,
  cloudRunRole,
  cloudStallStep,
  completeUnderRunPolicy,
  initialCloudRunModelState,
  recordModelCascade,
  resumeCloudRunModelState,
  turnRequestFields,
  type CloudTurnRequest,
} from './cloudRunModelPolicy';

/** A gateway answer: an HTTP status and (on success) the model that served it. */
const answer = (status: number, resolvedModel?: string) => ({ response: { status }, ...(resolvedModel ? { resolvedModel } : {}) });

describe('the phase rule', () => {
  it('a ticket run codes; a plan or verify child starts in that phase; a non-phase child keeps its role', () => {
    expect(cloudRunRole(undefined)).toBe('code');
    expect(cloudRunRole('plan')).toBe('plan');
    expect(cloudRunRole('verify')).toBe('verify');
    expect(cloudRunRole('explore')).toBe('explore');
    expect(cloudRunPolicyRole('explore')).toEqual({ startPhase: 'code', fixedRole: 'explore' });
    // A board delivery role is not a model role: the run still codes.
    expect(cloudRunRole('reviewer')).toBe('code');
  });
});

describe('completeUnderRunPolicy', () => {
  it('asks for the seed, then LOCKS onto what served turn 1', async () => {
    let state = initialCloudRunModelState({ model: 'seed-coder', strict: false }, undefined);
    const asked: CloudTurnRequest[] = [];
    const call = async (req: CloudTurnRequest) => { asked.push(req); return answer(200, 'served-coder'); };
    state = (await completeUnderRunPolicy(state, call, async () => undefined)).state;
    state = (await completeUnderRunPolicy(state, call, async () => undefined)).state;
    expect(asked.map((r) => [r.model, r.strict, r.role])).toEqual([['seed-coder', false, 'code'], ['served-coder', false, 'code']]);
  });

  it('drops a strict pin on 429 and re-asks once on the cascade, recording the hand-off', async () => {
    const state = initialCloudRunModelState({ model: 'opus', strict: true }, undefined);
    const asked: CloudTurnRequest[] = [];
    const statuses = [429, 200];
    const onRetry = vi.fn(async () => undefined);
    const { result, state: next } = await completeUnderRunPolicy(state, async (req) => {
      asked.push(req);
      return answer(statuses.shift()!, 'sonnet');
    }, onRetry);
    expect(result.response.status).toBe(200);
    expect(asked.map((r) => [r.model, r.strict])).toEqual([['opus', true], [undefined, false]]);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ kind: 'retry_turn', released: 'opus', status: 429 }));
    // Locked onto the cascade's answer for the rest of the run, never strict again.
    expect(next.policy.model).toBe('sonnet');
    expect(next.policy.strictPin).toBe(false);
  });

  it('cascades a project Evermind decline (400) but fails a 400 from anything else fast', async () => {
    const declined = await completeUnderRunPolicy(
      initialCloudRunModelState({ model: 'evermind/p7', strict: true }, undefined),
      vi.fn().mockResolvedValueOnce(answer(400)).mockResolvedValueOnce(answer(200, 'sonnet')),
      async () => undefined,
    );
    expect(declined.result.response.status).toBe(200);

    const call = vi.fn(async () => answer(400));
    const refused = await completeUnderRunPolicy(initialCloudRunModelState({ model: 'opus', strict: true }, undefined), call, async () => undefined);
    expect(refused.result.response.status).toBe(400);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('spends a forced tool choice on exactly one request', async () => {
    const state = { ...initialCloudRunModelState({ model: 'm', strict: false }, undefined), forceToolChoice: 'required' as const };
    let seen: CloudTurnRequest | undefined;
    const { state: next } = await completeUnderRunPolicy(state, async (req) => { seen = req; return answer(200, 'm'); }, async () => undefined);
    expect(turnRequestFields(seen!).tool_choice).toBe('required');
    expect(next.forceToolChoice).toBeUndefined();
  });
});

describe('resumeCloudRunModelState', () => {
  it('resumes a tick persisted before the policy existed on its locked model', () => {
    const state = resumeCloudRunModelState(undefined, 'locked-model', { model: 'seed', strict: false }, undefined);
    expect(state.policy.model).toBe('locked-model');
  });

  it('keeps a persisted policy as it is', () => {
    const saved = initialCloudRunModelState({ model: 'x', strict: true }, 'verify');
    expect(resumeCloudRunModelState(saved, 'other', { model: 'seed', strict: false }, undefined)).toBe(saved);
  });
});

describe('cloudStallStep', () => {
  const promise = { text: "I'll search the codebase for the handler.", toolCallCount: 0, toolNames: ['read_file', 'write_file'], requestText: 'Fix the handler' };

  it('re-prompts, then fails over onto the coding surface, then stops', () => {
    let state = initialCloudRunModelState({ model: 'grok', strict: false }, undefined);
    const surface = { codingModels: ['grok', 'sonnet'] };
    for (let i = 0; i < MAX_ANNOUNCEMENT_RECOVERIES; i += 1) {
      const r = cloudStallStep(state, { ...promise, resolvedModel: 'grok' }, surface);
      expect(r.step.kind).toBe('nudge');
      expect(r.state.forceToolChoice).toBe('required');
      state = r.state;
    }
    const failover = cloudStallStep(state, { ...promise, resolvedModel: 'grok' }, surface);
    expect(failover.step).toMatchObject({ kind: 'failover', to: 'sonnet' });
    expect(failover.state.stallRecoveries).toBe(0);
    expect(failover.state.policy.model).toBe('sonnet');
  });

  it('a turn that acted resets the budget and does nothing else', () => {
    const state = { ...initialCloudRunModelState({ model: 'grok', strict: false }, undefined), stallRecoveries: 2 };
    const r = cloudStallStep(state, { ...promise, toolCallCount: 1 }, null);
    expect(r.step).toEqual({ kind: 'none' });
    expect(r.state.stallRecoveries).toBe(0);
  });
});

describe('recordModelCascade', () => {
  it('names the released model and why', async () => {
    await recordModelCascade({} as never, { tenantId: 1, executionId: 2 }, { kind: 'retry_turn', released: 'opus', status: 413 }, 4);
    expect(recordCloudToolEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      toolName: 'model.cascade',
      detail: { step: 4, from: 'opus', reason: '413' },
    }));
  });
});
