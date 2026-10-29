import { describe, expect, it, vi } from 'vitest';
import { renderTaskState } from '@builderforce/agent-run';
import { openCostLoopSession, type CostLoopSessionArgs } from './costLoopSession';
import { renderBudget } from './runBudget';

// The cases that exercised the session's tool catalog, volatile tail, task state and compaction plumbing moved with the
// behaviour to the agent (`packages/agent-run/test/tools/deferredCatalog.test.ts`); what is left is the cloud's
// CONTAINMENT: the A2 token cap and budget line, the D5 reply cap, the declared limits and the team alert.

const alert = vi.hoisted(() => ({ notifyContainmentStop: vi.fn(async () => 'raised' as const) }));
vi.mock('../../alerts/containmentAlert', () => alert);

const ALL_ON = {
  COST_LEVER_A2_RUN_BUDGET: 'on', COST_LEVER_B1_STABLE_PREFIX: 'on', COST_LEVER_C1_DEFERRED_TOOLS: 'on',
  COST_LEVER_C2_OBSERVATION_MASKING: 'on', COST_LEVER_C3_TASK_STATE: 'on', COST_LEVER_D5_OUTPUT_CAPS: 'on',
};

function args(env: Record<string, string>, over: Partial<CostLoopSessionArgs> = {}): CostLoopSessionArgs {
  return {
    env: env as never, db: {} as never, tenantId: 7, executionId: 11, meterExecutionId: 11, plan: 'free', role: 'code',
    // A resumed tick with A2 totals, so no ledger/payload read is needed.
    resume: { tokenCap: 1_000, spentMillicents: 0, tokensUsed: 0 },
    record: vi.fn(async () => undefined),
    ...over,
  };
}

// New (not one of the original cases): the original levers-off case asserted the retired catalog / tail / compaction plumbing
// (`tools()`, `turnMessages()`, `compactOptions()`, `dispatch()`); this pins what the session still does with every lever off.
describe('cost loop session — containment, levers off', () => {
  const off = { COST_LEVERS_ALL: 'off' };

  it('keeps the caller max_tokens, contains nothing and persists nothing', async () => {
    const s = await openCostLoopSession(args(off, { resume: undefined }));
    expect(await s.beforeTurn(0, undefined, 0, 0)).toBeNull();
    expect(s.snapshot()).toEqual({});
    expect(s.turnFields(undefined)).toEqual({});
    expect(s.turnFields(500)).toEqual({ max_tokens: 500 });
  });
});

describe('cost loop session — levers on', () => {
  it('D5: caps max_tokens by role, keeping a lower caller value', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    expect(s.turnFields(undefined)).toEqual({ max_tokens: 8_192 });
    expect(s.turnFields(1_000)).toEqual({ max_tokens: 1_000 });
  });

  it('A2: counts tokens (BYO included), shows the budget line, converges at 80%, stops at 100% with progress', async () => {
    const a = args(ALL_ON);
    const s = await openCostLoopSession(a);
    expect(await s.beforeTurn(0, undefined, 0, 0)).toBeNull();
    expect(s.budgetNote()).toContain('~1000 tokens');
    await s.recordTurn({ usage: { promptTokens: 700, completionTokens: 150, totalTokens: 850 }, resolvedModel: 'm', byoFunded: true });
    expect(await s.beforeTurn(1, undefined, 0, 0)).toBeNull();
    expect(s.budgetNote()).toContain('converge');
    await s.recordTurn({ usage: { promptTokens: 200, completionTokens: 0, totalTokens: 200 }, resolvedModel: 'm', byoFunded: true });
    // The agent's task state, rendered, rides the stop so a follow-up run can resume from it.
    const stop = await s.beforeTurn(2, undefined, 0, 0, renderTaskState({ nextStep: 'write the test' }));
    expect(stop).toMatch(/^Run contained: token limit reached \(1050\/1000 tokens\)\./);
    expect(stop).toContain('Next step: write the test');
    expect(s.snapshot()).toMatchObject({ tokensUsed: 1_050, spentMillicents: 0, tokenCap: 1_000 });
    // A5: the stop is pushed to the team, not only left on the timeline.
    expect(alert.notifyContainmentStop).toHaveBeenCalledWith(a.env, a.db, expect.objectContaining({
      tenantId: 7, executionId: 11, taskId: null, spendMillicents: 0, reason: expect.stringContaining('token limit reached'),
    }));
  });

  it('A2: a RESUMED tick shows the budget line from the run\'s totals before any turn is checked', async () => {
    const s = await openCostLoopSession(args(ALL_ON, { resume: { tokenCap: 1_000, spentMillicents: 0, tokensUsed: 850 } }));
    // No `beforeTurn` yet: the line already tells the model it is near the cap, on the FIRST turn of the tick.
    expect(s.budgetNote()).toContain('converge');
    expect(s.budgetNote()).toContain('~150 tokens');
  });

  it('A2: the budget line names dollars only when a spend limit is declared', () => {
    expect(renderBudget({ maxFiles: null, maxRepositories: null, maxSpendMillicents: 400_000, maxTokens: 10 }, { files: 0, repositories: 0, spendMillicents: 100_000, tokens: 1 }))
      .toBe('Budget left: ~$3.00, ~9 tokens.');
    expect(renderBudget({ maxFiles: null, maxRepositories: null, maxSpendMillicents: null }, { files: 0, repositories: 0, spendMillicents: 0 })).toBe('');
  });
});
