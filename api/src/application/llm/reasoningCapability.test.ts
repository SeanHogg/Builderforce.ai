import { describe, expect, it } from 'vitest';
import { detectReasoningSupport, reasoningParamsForModel } from './reasoningCapability';

describe('detectReasoningSupport', () => {
  it('classifies bare claude-* as direct-Anthropic thinking', () => {
    expect(detectReasoningSupport('claude-opus-4-8').kind).toBe('anthropic-thinking');
    expect(detectReasoningSupport('claude-sonnet-4-6').kind).toBe('anthropic-thinking');
  });

  it('does NOT treat OpenRouter-routed anthropic/claude-* as thinking-capable (OpenAI shape)', () => {
    expect(detectReasoningSupport('anthropic/claude-sonnet-4.6').kind).toBe('none');
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
  it('emits Anthropic thinking with a budget scaled by think level (high)', () => {
    expect(reasoningParamsForModel('claude-opus-4-8', { thinkLevel: 'high' })).toEqual({
      thinking: { type: 'enabled', budget_tokens: 16384 },
    });
  });

  it('emits Anthropic thinking (medium default) when only reasoningLevel is on', () => {
    expect(reasoningParamsForModel('claude-sonnet-4-6', { reasoningLevel: 'on' })).toEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
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
});
