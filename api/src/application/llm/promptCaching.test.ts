import { describe, expect, it } from 'vitest';
import { applyPromptCaching, markAnthropicHistoryBreakpoint, modelSupportsExplicitCaching } from './promptCaching';

// ---------------------------------------------------------------------------
// modelSupportsExplicitCaching — gate to the Anthropic family (the only gateway
// upstreams that need an explicit cache_control marker to cache).
// ---------------------------------------------------------------------------

describe('modelSupportsExplicitCaching', () => {
  it('matches OpenRouter Anthropic catalog ids', () => {
    expect(modelSupportsExplicitCaching('anthropic/claude-sonnet-5')).toBe(true);
    expect(modelSupportsExplicitCaching('anthropic/claude-haiku-4.5')).toBe(true);
  });

  it('matches a caller-pinned vendor-prefixed Anthropic id', () => {
    expect(modelSupportsExplicitCaching('openrouter/anthropic/claude-3-haiku')).toBe(true);
  });

  it('does not match auto-caching / non-caching families', () => {
    expect(modelSupportsExplicitCaching('openai/gpt-4.1')).toBe(false);
    expect(modelSupportsExplicitCaching('google/gemini-2.5-pro')).toBe(false);
    expect(modelSupportsExplicitCaching('x-ai/grok-3-mini')).toBe(false);
    expect(modelSupportsExplicitCaching('meta-llama/llama-3.3-70b-instruct:free')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyPromptCaching — breakpoint injection on the stable prefix.
// ---------------------------------------------------------------------------

describe('applyPromptCaching — gating', () => {
  it('returns the same array reference for non-Anthropic models (no-op)', () => {
    const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
    expect(applyPromptCaching(messages, 'openai/gpt-4.1')).toBe(messages);
  });

  it('returns the input for empty messages', () => {
    const messages: Array<Record<string, unknown>> = [];
    expect(applyPromptCaching(messages, 'anthropic/claude-sonnet-5')).toBe(messages);
  });

  it('respects caller-managed cache_control and leaves placement untouched', () => {
    const messages = [
      { role: 'system', content: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'hi' },
    ];
    expect(applyPromptCaching(messages, 'anthropic/claude-sonnet-5')).toBe(messages);
  });
});

describe('applyPromptCaching — system prefix', () => {
  it('promotes a string system prompt to a cache-marked text block', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful agent.' },
      { role: 'user', content: 'hi' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[0]!.content).toEqual([
      { type: 'text', text: 'You are a helpful agent.', cache_control: { type: 'ephemeral' } },
    ]);
    // The final turn is the latest markable one, so it carries the history
    // breakpoint too — that is what lets the NEXT request read this turn as prefix.
    expect(out[1]!.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('marks the last text part of an array-content system prompt', () => {
    const messages = [
      { role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      { role: 'user', content: 'hi' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-haiku-4.5');
    expect(out[0]!.content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('does not mutate the caller-supplied array or its messages', () => {
    // Three turns so there IS a message between the two breakpoints (system + latest
    // turn) — that middle one is what proves unmarked messages are reused, not cloned.
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out).not.toBe(messages);
    expect(messages[0]!.content).toBe('sys'); // original untouched
    expect(messages[2]!.content).toBe('a1');
    expect(out[1]).toBe(messages[1]); // unmarked messages reused by reference
  });
});

describe('applyPromptCaching — history boundary', () => {
  it('marks the LATEST turn so the next request reads the whole conversation as a cached prefix', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    // system (index 0) and the latest turn (index 3) marked; the middle untouched.
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    expect(out[2]!.content).toBe('a1');
    expect(out[3]!.content).toEqual([{ type: 'text', text: 'q2', cache_control: { type: 'ephemeral' } }]);
  });

  it('walks back past tool turns and text-less tool-call turns to the nearest markable one', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'tool-result' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[3]!.content).toBe('tool-result'); // tool turn never promoted on this path
    expect(out[2]!.content).toBe(''); // nothing to attach to
    expect(out[1]!.content).toEqual([{ type: 'text', text: 'q', cache_control: { type: 'ephemeral' } }]);
  });
});

describe('markAnthropicHistoryBreakpoint (direct Messages shape)', () => {
  it('marks the last block of the last message — a tool_result included — and clones only that', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '...' }, { type: 'tool_result', tool_use_id: 'c2', content: '...' }] },
    ];
    const out = markAnthropicHistoryBreakpoint(messages);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
    expect(out[2]!.content[0]).toBe(messages[2]!.content[0]);
    expect(out[2]!.content[1]).toEqual({ type: 'tool_result', tool_use_id: 'c2', content: '...', cache_control: { type: 'ephemeral' } });
    expect(messages[2]!.content[1]).not.toHaveProperty('cache_control'); // input untouched
  });

  it('leaves an empty final message alone', () => {
    const messages = [{ role: 'user', content: [] as Array<Record<string, unknown>> }];
    expect(markAnthropicHistoryBreakpoint(messages)[0]!.content).toEqual([]);
    expect(markAnthropicHistoryBreakpoint([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyPromptCaching — TTL opt-in (5m default vs 1h long retention).
// ---------------------------------------------------------------------------

describe('applyPromptCaching — cache TTL', () => {
  it('defaults to bare ephemeral (5-min) when no ttl is passed', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
  });

  it("emits ttl:'1h' on every breakpoint when ttl='1h'", () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5', '1h');
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
    expect(out[2]!.content).toBe('a1');
    expect(out[3]!.content).toEqual([{ type: 'text', text: 'q2', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  });

  it("treats ttl='5m' as the default bare ephemeral marker", () => {
    const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
    const out = applyPromptCaching(messages, 'anthropic/claude-haiku-4.5', '5m');
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
  });
});
