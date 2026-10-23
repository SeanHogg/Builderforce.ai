import { describe, expect, it } from 'vitest';
import { MODEL_ROLES } from '@builderforce/agent-tools';
import { effectiveReasoningExecParams, escalateThinkLevel, ROLE_REASONING_EFFORT, roleReasoningExecParams } from './roleReasoning';
import { detectReasoningSupport, reasoningIntentOpts, reasoningParamsForModel } from './reasoningCapability';
import { resolveDispatchReasoningIntent } from './dispatchReasoningIntent';

describe('role → reasoning effort table (D4)', () => {
  it('covers every model role', () => {
    for (const role of MODEL_ROLES) expect(ROLE_REASONING_EFFORT[role]).toBeTruthy();
  });

  it('maps the documented defaults', () => {
    expect(roleReasoningExecParams('explore')).toEqual({ thinkLevel: 'minimal' });
    expect(roleReasoningExecParams('utility')).toEqual({ thinkLevel: 'minimal' });
    expect(roleReasoningExecParams('verify')).toEqual({ thinkLevel: 'low' });
    expect(roleReasoningExecParams('chat')).toEqual({ thinkLevel: 'low' });
    expect(roleReasoningExecParams('code')).toEqual({ thinkLevel: 'medium' });
    expect(roleReasoningExecParams('plan')).toEqual({ thinkLevel: 'high' });
    expect(roleReasoningExecParams('architect')).toBeUndefined();
    expect(roleReasoningExecParams(undefined)).toBeUndefined();
  });

  it('escalates one step and saturates at xhigh', () => {
    expect(escalateThinkLevel('off')).toBe('minimal');
    expect(escalateThinkLevel('low')).toBe('medium');
    expect(escalateThinkLevel('high')).toBe('xhigh');
    expect(escalateThinkLevel('xhigh')).toBe('xhigh');
  });

  it('explicit always wins; the role applies only when the lever is on and nothing was chosen', () => {
    expect(effectiveReasoningExecParams({ thinkLevel: 'high' }, 'explore', true)).toEqual({ thinkLevel: 'high' });
    expect(effectiveReasoningExecParams(undefined, 'explore', false)).toBeUndefined();
    expect(effectiveReasoningExecParams(undefined, 'plan', true)).toEqual({ thinkLevel: 'high' });
    // A persona that set only a temperature has not chosen an effort.
    expect(effectiveReasoningExecParams({ temperature: 0.3 }, 'code', true)).toEqual({ temperature: 0.3, thinkLevel: 'medium' });
  });
});

describe('reasoningParamsForModel · D4 inputs', () => {
  it('escalate raises the level before the family mapping', () => {
    expect(reasoningParamsForModel('gpt-5', { thinkLevel: 'low' })).toEqual({ reasoning_effort: 'low' });
    expect(reasoningParamsForModel('gpt-5', { thinkLevel: 'low' }, { escalate: true })).toEqual({ reasoning_effort: 'medium' });
    // Anthropic thinks only from `high`: a `medium` code turn escalated to `high` thinks.
    expect(reasoningParamsForModel('claude-sonnet-5', { thinkLevel: 'medium' })).toBeUndefined();
    expect(reasoningParamsForModel('claude-sonnet-5', { thinkLevel: 'medium' }, { escalate: true }))
      .toEqual({ thinking: { type: 'adaptive' }, thinkingEffort: 'high' });
  });

  it('an OpenRouter hop gets `reasoning: { effort }` only when the catalog lists it', () => {
    const set = new Set(['anthropic/claude-sonnet-5.5']);
    const opts = { openRouterSlug: 'anthropic/claude-sonnet-5.5', openRouterReasoning: set };
    expect(detectReasoningSupport('openrouter/anthropic/claude-sonnet-5.5', opts).kind).toBe('openrouter-reasoning');
    expect(reasoningParamsForModel('openrouter/anthropic/claude-sonnet-5.5', { thinkLevel: 'high' }, opts))
      .toEqual({ reasoning: { effort: 'high' } });
    // Not listed, or no catalog → nothing (never a guess).
    expect(reasoningParamsForModel('openrouter/x/y', { thinkLevel: 'high' }, { openRouterSlug: 'x/y', openRouterReasoning: set })).toBeUndefined();
    expect(reasoningParamsForModel('openrouter/anthropic/claude-sonnet-5.5', { thinkLevel: 'high' }, { openRouterSlug: 'anthropic/claude-sonnet-5.5' })).toBeUndefined();
    // `off` sends nothing even on a listed slug.
    expect(reasoningParamsForModel('openrouter/anthropic/claude-sonnet-5.5', { thinkLevel: 'off' }, opts)).toBeUndefined();
  });

  it('forwards the intent hints without its exec levers', () => {
    expect(reasoningIntentOpts({ execParams: { thinkLevel: 'low' }, isFirstTurn: true, escalate: true }))
      .toEqual({ isFirstTurn: true, escalate: true });
  });
});

describe('resolveDispatchReasoningIntent', () => {
  const slugs = async () => new Set(['a/b']);

  it('lever off: only the explicit client level, no catalog read', async () => {
    const env = { COST_LEVER_D4_ROLE_REASONING: 'off' } as never;
    let peeked = false;
    const peek = async () => { peeked = true; return new Set<string>(); };
    expect(await resolveDispatchReasoningIntent(env, { reasoning: undefined, role: 'plan', isFirstTurn: true, tenantId: 1 }, peek)).toBeUndefined();
    expect(await resolveDispatchReasoningIntent(env, { reasoning: { level: 'high' }, role: 'plan', isFirstTurn: false, tenantId: 1 }, peek))
      .toEqual({ execParams: { thinkLevel: 'high' }, isFirstTurn: false });
    expect(peeked).toBe(false);
  });

  it('lever on: the role default plus the catalog slugs', async () => {
    const env = { COST_LEVER_D4_ROLE_REASONING: 'on' } as never;
    expect(await resolveDispatchReasoningIntent(env, { reasoning: undefined, role: 'explore', isFirstTurn: true, tenantId: 1, escalate: true }, slugs))
      .toEqual({ execParams: { thinkLevel: 'minimal' }, isFirstTurn: true, escalate: true, openRouterReasoning: new Set(['a/b']) });
    // Explicit still wins with the lever on.
    expect((await resolveDispatchReasoningIntent(env, { reasoning: { level: 'low' }, role: 'plan', isFirstTurn: true, tenantId: 1 }, slugs))?.execParams)
      .toEqual({ thinkLevel: 'low' });
  });
});
