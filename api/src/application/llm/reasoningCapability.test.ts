import { describe, expect, it } from 'vitest';
import { detectReasoningSupport, reasoningParamsForModel } from './reasoningCapability';

describe('detectReasoningSupport', () => {
  it('classifies bare claude-* as direct-Anthropic thinking', () => {
    expect(detectReasoningSupport('claude-opus-4-8').kind).toBe('anthropic-thinking');
  });

  it('does NOT treat OpenRouter-routed anthropic/claude-* as thinking-capable (OpenAI shape)', () => {
    expect(detectReasoningSupport('anthropic/claude-sonnet-5').kind).toBe('none');
  });

  // Sonnet 5 supports thinking — but ONLY the adaptive form. It used to be excluded
  // from the thinking path wholesale to dodge the legacy manual budget's 400; now the
  // emitted shape is adaptive, so it participates like every other `claude-*` id.
  // The invariant that matters is the WIRE SHAPE, not the exclusion.
  it('sends ADAPTIVE (never legacy manual budget) thinking to Sonnet 5', () => {
    expect(detectReasoningSupport('claude-sonnet-5').kind).toBe('anthropic-thinking');
    const params = reasoningParamsForModel('claude-sonnet-5', { reasoningLevel: 'on' });
    expect(params).toEqual({ thinking: { type: 'adaptive' }, thinkingEffort: 'medium' });
    expect(JSON.stringify(params)).not.toContain('budget_tokens');
  });

  it('classifies OpenAI o-series / gpt-5 (bare or openai/ prefixed) as reasoning', () => {
    expect(detectReasoningSupport('o3').kind).toBe('openai-reasoning');
    expect(detectReasoningSupport('openai/o4-mini').kind).toBe('openai-reasoning');
    expect(detectReasoningSupport('openai/gpt-5-codex').kind).toBe('openai-reasoning');
  });

  it('excludes non-reasoning OpenAI + generic coders', () => {
    expect(detectReasoningSupport('openai/gpt-4.1').kind).toBe('none');
    expect(detectReasoningSupport('@cf/qwen/qwen3-30b-a3b-fp8').kind).toBe('none');
    expect(detectReasoningSupport('deepseek/deepseek-v4-flash').kind).toBe('none');
    expect(detectReasoningSupport('').kind).toBe('none');
    expect(detectReasoningSupport(undefined).kind).toBe('none');
  });
});

describe('reasoningParamsForModel', () => {
  it('emits Anthropic adaptive thinking with effort scaled by think level (high)', () => {
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'high' })).toEqual({
      thinking: { type: 'adaptive' }, thinkingEffort: 'high',
    });
  });

  it('emits Anthropic adaptive thinking (medium effort default) when only reasoningLevel is on', () => {
    expect(reasoningParamsForModel('claude-opus-4-8', { reasoningLevel: 'on' })).toEqual({
      thinking: { type: 'adaptive' }, thinkingEffort: 'medium',
    });
  });

  it('does NOT emit Anthropic thinking for a mere medium think level (gated tighter)', () => {
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'medium' })).toBeUndefined();
  });

  it('maps think level to OpenAI reasoning_effort', () => {
    expect(reasoningParamsForModel('openai/o3', { thinkLevel: 'high' })).toEqual({ reasoning_effort: 'high' });
    expect(reasoningParamsForModel('openai/gpt-5', { thinkLevel: 'low' })).toEqual({ reasoning_effort: 'low' });
    expect(reasoningParamsForModel('o4-mini', { reasoningLevel: 'on' })).toEqual({ reasoning_effort: 'medium' });
  });

  it('drops the lever for unsupported models and empty exec params (V2 byte-identical)', () => {
    expect(reasoningParamsForModel('@cf/zai-org/glm-4.7-flash', { thinkLevel: 'high' })).toBeUndefined();
    expect(reasoningParamsForModel('claude-opus-4-8', {})).toBeUndefined();
    expect(reasoningParamsForModel('claude-opus-4-8', undefined)).toBeUndefined();
    expect(reasoningParamsForModel('openai/o3', { thinkLevel: 'off' })).toBeUndefined();
  });

  it('threads the first-turn hint ONLY onto the Anthropic thinking path', () => {
    // First turn → firstTurn:true rides alongside the adaptive thinking lever.
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'high' }, { isFirstTurn: true })).toEqual({
      thinking: { type: 'adaptive' }, thinkingEffort: 'high',
      firstTurn: true,
    });
    // Continuation turn → firstTurn:false (the vendor keeps thinking off with tools).
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'high' }, { isFirstTurn: false })).toEqual({
      thinking: { type: 'adaptive' }, thinkingEffort: 'high',
      firstTurn: false,
    });
    // No hint → unchanged shape (existing callers unaffected).
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'high' }, {})).toEqual({
      thinking: { type: 'adaptive' }, thinkingEffort: 'high',
    });
  });

  it('never leaks the first-turn hint onto the OpenAI reasoning path', () => {
    expect(reasoningParamsForModel('openai/o3', { thinkLevel: 'high' }, { isFirstTurn: true })).toEqual({
      reasoning_effort: 'high',
    });
  });

  it('emits no hint when the model does not want thinking (even with a first-turn hint)', () => {
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'medium' }, { isFirstTurn: true })).toBeUndefined();
  });
});
