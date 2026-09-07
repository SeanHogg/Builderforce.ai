import { describe, expect, it } from 'vitest';
import { splitReasoning } from './reasoningContent';

/**
 * GAP B1 — one reader for every vendor's reasoning shape, so the `thinking`
 * timeline row is written identically whichever model served the turn.
 */
describe('splitReasoning', () => {
  it('reads reasoning_content (DeepSeek / OpenAI-compatible / normalised Anthropic thinking)', () => {
    expect(splitReasoning({ content: 'answer', reasoning_content: 'I should check the tests first.' })).toEqual({
      content: 'answer',
      reasoning: 'I should check the tests first.',
    });
  });

  it('reads OpenRouter flat `reasoning` and structured `reasoning_details`', () => {
    expect(splitReasoning({ content: 'a', reasoning: 'flat' }).reasoning).toBe('flat');
    expect(
      splitReasoning({
        content: 'a',
        reasoning_details: [
          { type: 'reasoning.text', text: 'step one' },
          { type: 'reasoning.encrypted', data: 'xxx' },
          { type: 'reasoning.text', text: 'step two' },
        ],
      }).reasoning,
    ).toBe('step one\nstep two');
  });

  it('lifts inline <think> segments out of the visible content', () => {
    const out = splitReasoning({ content: '<think>plan: read file</think>\n\nHere is the fix.' });
    expect(out).toEqual({ content: 'Here is the fix.', reasoning: 'plan: read file' });
  });

  it('is empty for a turn with no reasoning and tolerates a null message', () => {
    expect(splitReasoning({ content: 'plain' })).toEqual({ content: 'plain', reasoning: '' });
    expect(splitReasoning(null)).toEqual({ content: '', reasoning: '' });
    expect(splitReasoning({ content: null })).toEqual({ content: '', reasoning: '' });
  });
});
