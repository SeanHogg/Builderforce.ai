import { describe, expect, it } from 'vitest';
import { VOLATILE_TAIL_TAG } from '@seanhogg/builderforce-memory/handoff';
import { ANTHROPIC_MAX_BREAKPOINTS, applyPromptCaching, modelSupportsExplicitCaching } from './promptCaching';

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

  it('marks the latest tool result so a tool loop caches its whole history; skips text-less tool-call turns', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'tool-result' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[3]!.content).toEqual([{ type: 'text', text: 'tool-result', cache_control: { type: 'ephemeral' } }]);
    expect(out[2]!.content).toBe(''); // nothing to attach to
    // Fallback (review #16): the last stable TEXT message behind a tool-result breakpoint
    // is marked too, so the prefix still caches if the tool-part marker is dropped.
    expect(out[1]!.content).toEqual([{ type: 'text', text: 'q', cache_control: { type: 'ephemeral' } }]);
  });

  it('adds no fallback when the history breakpoint is already on a text message', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[2]).toBe(messages[2]);
    expect(out[1]).toBe(messages[1]);
  });

  it('places the fallback behind the volatile tail and never exceeds the breakpoint cap', () => {
    const tail = `${VOLATILE_TAIL_TAG}
budget: 40%
</run-state>`;
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'thinking', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'r1' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c2' }] },
      { role: 'tool', content: 'r2' },
      { role: 'user', content: tail },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    const marked = out
      .map((m, i) => (Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).some((p) => 'cache_control' in p) ? i : -1))
      .filter((i) => i >= 0);
    expect(marked).toEqual([0, 2, 5]); // system, the assistant text turn, the newest tool result
    expect(out[6]).toBe(messages[6]);
    expect(marked.length).toBeLessThanOrEqual(ANTHROPIC_MAX_BREAKPOINTS - 1); // one slot left for tools
  });

  it('never marks the per-turn volatile tail (B1) — the breakpoint goes on the message before it', () => {
    const tail = `${VOLATILE_TAIL_TAG}
budget: 40%
</run-state>`;
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: tail },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[3]!.content).toBe(tail);
    expect(out[2]!.content).toEqual([{ type: 'text', text: 'a1', cache_control: { type: 'ephemeral' } }]);
  });

  it('also recognises a block-content volatile tail', () => {
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'user', content: [{ type: 'text', text: `${VOLATILE_TAIL_TAG}
x` }] },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[1]).toBe(messages[1]);
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'q1', cache_control: { type: 'ephemeral' } }]);
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
