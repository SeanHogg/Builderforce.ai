import { describe, expect, it, vi } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';

const g = vi.hoisted(() => ({
  skip: vi.fn(async (..._a: unknown[]) => false),
  outcome: vi.fn(async (..._a: unknown[]) => undefined),
  rate: vi.fn(async (..._a: unknown[]): Promise<number | undefined> => undefined),
}));
vi.mock('../../llm/difficultyGate', () => ({ shouldSkipWeakAttempt: g.skip, recordCascadeOutcome: g.outcome, weakPassRate: g.rate }));

import { CascadeSession } from './verifierCascade';
import { isReadOnlyCloudTool, readOnlyDispatchPort } from './parallelReads';
import type { CloudRunModelState } from '../cloudAgent/cloudRunModelPolicy';

const ON = { COST_LEVER_D1_VERIFIER_CASCADE: 'on' };
const ladder = { candidates: ['weak', 'mid'], rankOf: (m: string) => (m === 'weak' ? 0 : 1) };
const features = { actionType: 'bugfix', role: 'code', promptTokens: 10, toolCount: 3, turnIndex: 0 };
const state = (): CloudRunModelState => ({ policy: initialRunPolicy({ pinnedModel: 'weak', startPhase: 'code' }), stallRecoveries: 0 });

describe('CascadeSession', () => {
  it('raises reasoning one level per open escalation, from the role default', async () => {
    const s = new CascadeSession(ON, 1);
    await s.seed(state(), { strict: false, ladder, features });
    expect(s.execParams(undefined, 'code')).toBeUndefined();
    await s.verdict(state(), 'code_edit', { passed: false, verifier: 'changed_files' }, { db: {}, tenantId: 1, executionId: 2, role: 'code', ladder, attemptModel: 'weak', features });
    expect(s.execParams(undefined, 'code')).toEqual({ thinkLevel: 'high' });
    expect(s.execParams({ temperature: 0.2, thinkLevel: 'low' }, 'code')).toEqual({ temperature: 0.2, thinkLevel: 'medium' });
  });

  it('is inert with the lever off, and keeps the first tick\'s facts for later ticks', async () => {
    const s = new CascadeSession({ COST_LEVERS_ALL: 'off' }, 1);
    const seeded = await s.seed(state(), { strict: false, ladder, features });
    expect(seeded.policy.model).toBe('weak');
    const resumed = new CascadeSession({ COST_LEVERS_ALL: 'off' }, 1, JSON.parse(JSON.stringify(s.snapshot())));
    expect(resumed.featuresActionType('other')).toBe('bugfix');
    // A3 may still move a soft run up, through the cascade's ladder.
    expect(resumed.escalate(state(), ladder, 'weak')?.policy.model).toBe('mid');
  });
});

describe('CascadeSession — D2 prior weak-pass rate', () => {
  it('reads the tenant + action-type rate once, feeds it to the router and the training row, and carries it across ticks', async () => {
    g.rate.mockClear(); g.skip.mockClear(); g.outcome.mockClear();
    g.rate.mockResolvedValue(0.8);
    const db = { tag: 'db' };
    const s = new CascadeSession(ON, 7, undefined, db);
    await s.seed(state(), { strict: false, ladder, features });
    expect(g.rate).toHaveBeenCalledWith(ON, db, 7, 'bugfix');
    expect(g.skip.mock.calls[0]?.[2]).toMatchObject({ priorWeakPassRate: 0.8 });
    const resumed = new CascadeSession(ON, 7, JSON.parse(JSON.stringify(s.snapshot())), db);
    await resumed.verdict(state(), 'code_edit', { passed: true, verifier: 'changed_files' }, { db, tenantId: 7, executionId: 2, role: 'code', ladder, attemptModel: 'weak', features });
    expect(g.rate).toHaveBeenCalledTimes(1);
    expect(g.outcome.mock.calls[0]?.[2]).toMatchObject({ features: { priorWeakPassRate: 0.8 } });
  });

  it('leaves the feature unset for a cold tenant, and does not ask again', async () => {
    g.rate.mockClear(); g.skip.mockClear();
    g.rate.mockResolvedValue(undefined);
    const s = new CascadeSession(ON, 7, undefined, {});
    await s.seed(state(), { strict: false, ladder, features });
    expect(g.skip.mock.calls[0]?.[2]).not.toHaveProperty('priorWeakPassRate');
    const resumed = new CascadeSession(ON, 7, JSON.parse(JSON.stringify(s.snapshot())), {});
    await resumed.verdict(state(), 'code_edit', { passed: true, verifier: 'changed_files' }, { db: {}, tenantId: 7, executionId: 2, role: 'code', ladder, attemptModel: 'weak', features });
    expect(g.rate).toHaveBeenCalledTimes(1);
  });
});

describe('parallelReads (D8)', () => {
  it('names read tools only, and offers the port only while the lever is on', () => {
    expect(isReadOnlyCloudTool('search_code')).toBe(true);
    expect(isReadOnlyCloudTool('edit_file')).toBe(false);
    expect(readOnlyDispatchPort({ COST_LEVERS_ALL: 'off' }, 1)).toEqual({});
    expect(typeof readOnlyDispatchPort({ COST_LEVER_D8_PARALLEL_TOOL_CALLS: 'on' }, 1).isReadOnly).toBe('function');
  });
});
