/**
 * The three histories a strict vendor rejects with a bare `INVALID_ARGUMENT` — and
 * the invariant that matters more than any of them: reshaping must never change what
 * the conversation SAYS.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  sanitizeMessageShape,
  needsMessageShapeSanitizing,
  type ChatMessageLike,
} from './messageShapeSanitizer';
// Importing the registry is what installs the resolver (it does so at module init,
// the same way it installs the schema-dialect one).
import './vendors';

beforeAll(() => {
  // Guard the wiring itself: if the registry ever stops calling
  // `registerStrictShapeResolver`, the sanitizer silently becomes a no-op and every
  // assertion below would still "pass" against unreshaped input.
  expect(needsMessageShapeSanitizing('googleai/gemini-2.5-flash')).toBe(true);
});

describe('needsMessageShapeSanitizing — catalog-driven, not a vendor-id list', () => {
  it('is on for a limited decoder and off for a full one', () => {
    expect(needsMessageShapeSanitizing('googleai/gemini-2.5-flash')).toBe(true);
    expect(needsMessageShapeSanitizing('google/gemini-2.5-pro')).toBe(true); // OpenRouter-routed
    expect(needsMessageShapeSanitizing('anthropic/claude-sonnet-5')).toBe(false);
    expect(needsMessageShapeSanitizing('openai/gpt-4.1')).toBe(false);
  });
});

describe('sanitizeMessageShape', () => {
  it('returns the SAME ARRAY when nothing needs fixing', () => {
    const messages: ChatMessageLike[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    // Reference equality — the common path must allocate nothing.
    expect(sanitizeMessageShape(messages)).toBe(messages);
  });

  it('prepends a neutral turn when the history does not lead with `user`', () => {
    // A resumed agent turn replays [assistant, user, …]; Gemini requires `user` first.
    const out = sanitizeMessageShape([
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'follow up' },
    ]);
    expect(out[0]!.role).toBe('user');
    // NOT relabelled: attributing the model's own words to the caller would change
    // what the conversation means, which is worse than the 400 it avoids.
    expect(out[1]).toEqual({ role: 'assistant', content: 'earlier answer' });
    expect(out[2]).toEqual({ role: 'user', content: 'follow up' });
  });

  it('lets system messages lead — they are exempt from the alternation rule', () => {
    const out = sanitizeMessageShape([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(out.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('rewrites an empty tool-call `arguments` to `{}`', () => {
    // A model taking a no-argument tool emits `""`; the two mean the same thing and
    // only the validator disagrees.
    const out = sanitizeMessageShape([
      { role: 'user', content: 'go' },
      { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'ping', arguments: '' } }] },
    ]);
    expect((out[1]!.tool_calls as Array<{ function: { arguments: string } }>)[0]!.function.arguments).toBe('{}');
    // The rest of the call is untouched.
    expect((out[1]!.tool_calls as Array<{ id: string }>)[0]!.id).toBe('t1');
  });

  it('merges consecutive same-role turns instead of dropping one', () => {
    const out = sanitizeMessageShape([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]);
    expect(out).toHaveLength(1);
    // Nothing is lost — that is the whole rule.
    expect(out[0]!.content).toBe('first\n\nsecond');
  });

  it('never merges `tool` messages — that would break the tool_call_id pairing', () => {
    const out = sanitizeMessageShape([
      { role: 'user', content: 'go' },
      { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: 'r1' },
      { role: 'tool', tool_call_id: 'b', content: 'r2' },
    ]);
    expect(out.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  it('never merges assistant turns that carry tool calls', () => {
    // Two tool-calling assistant turns are distinct actions, not one message split.
    const out = sanitizeMessageShape([
      { role: 'user', content: 'go' },
      { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{}' } }] },
      { role: 'assistant', tool_calls: [{ id: 'b', function: { name: 'y', arguments: '{}' } }] },
    ]);
    expect(out.filter((m) => m.role === 'assistant')).toHaveLength(2);
  });

  it('merges array-content turns without flattening them to a string', () => {
    const out = sanitizeMessageShape([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: 'b' },
    ]);
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  });

  it('handles an empty list and a single system-only list', () => {
    expect(sanitizeMessageShape([])).toEqual([]);
    const sysOnly: ChatMessageLike[] = [{ role: 'system', content: 'sys' }];
    expect(sanitizeMessageShape(sysOnly)).toBe(sysOnly);
  });
});
