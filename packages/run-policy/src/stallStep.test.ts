import { describe, expect, it } from 'vitest';
import { MAX_ANNOUNCEMENT_RECOVERIES, MAX_MODEL_FAILOVERS } from '@builderforce/agent-stall';
import { initialRunPolicy, nextTurn, resolveStallStep } from './index.js';

const TOOLS = ['read_file', 'write_file'];
const promise = { text: "I'll search the codebase for the handler.", toolCallCount: 0, availableToolNames: TOOLS };

describe('resolveStallStep', () => {
  it('does nothing for a turn that acted, or a turn with nothing to call', () => {
    const policy = initialRunPolicy();
    expect(resolveStallStep(policy, { ...promise, toolCallCount: 1 }, 0).step).toEqual({ kind: 'none' });
    expect(resolveStallStep(policy, { ...promise, availableToolNames: [] }, 0).step).toEqual({ kind: 'none' });
    expect(resolveStallStep(policy, { ...promise, text: 'The handler lives in api/src/routes.ts.' }, 0).step).toEqual({ kind: 'none' });
  });

  it('re-prompts the same model first, forcing a tool call', () => {
    const { policy, step } = resolveStallStep(initialRunPolicy(), promise, 0);
    expect(step).toMatchObject({ kind: 'nudge', recoveriesUsed: 1, toolChoice: 'required', shape: 'announced' });
    expect(policy.failovers).toBe(0);
  });

  it('fails over once the re-prompt budget is spent, and resets the budget for the new model', () => {
    const { policy, step } = resolveStallStep(
      initialRunPolicy(),
      { ...promise, resolvedModel: 'grok' },
      MAX_ANNOUNCEMENT_RECOVERIES,
      { pick: (tried) => ['grok', 'claude'].find((m) => !tried.includes(m)) },
    );
    expect(step).toMatchObject({ kind: 'failover', from: 'grok', to: 'claude', attempt: 1, of: MAX_MODEL_FAILOVERS, recoveriesUsed: 0 });
    expect(nextTurn(policy, { hasTools: true }).model).toBe('claude');
  });

  it('stops and names what was tried when there is nowhere to go', () => {
    const { step } = resolveStallStep(initialRunPolicy(), { ...promise, resolvedModel: 'grok' }, MAX_ANNOUNCEMENT_RECOVERIES);
    expect(step.kind).toBe('exhausted');
    if (step.kind === 'exhausted') {
      expect(step.tried).toEqual(['grok']);
      expect(step.notice).toContain('grok');
    }
  });

  it('draws from the model surface', () => {
    const { step } = resolveStallStep(
      initialRunPolicy(),
      { ...promise, resolvedModel: 'grok' },
      MAX_ANNOUNCEMENT_RECOVERIES,
      { surface: { codingModels: ['grok', 'sonnet'] } },
    );
    expect(step).toMatchObject({ kind: 'failover', to: 'sonnet' });
  });
});
