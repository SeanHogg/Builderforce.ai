import { describe, it, expect } from 'vitest';
import { stripReasoningScratchpad } from './learnableText';

describe('stripReasoningScratchpad', () => {
  it('keeps the answer and drops the working-out around it', () => {
    const turn = '<think>The user is right - I should have deleted the branch.</think>\n\n'
      + 'Both API and Frontend are already on `main` — the fixes are merged and pushed.';
    expect(stripReasoningScratchpad(turn))
      .toBe('Both API and Frontend are already on `main` — the fixes are merged and pushed.');
  });

  it('removes a block whose closing tag was cut off by the transport cap', () => {
    // The observed shape: contributions are sliced at 8k, so a long think block arrives
    // with no `</think>` and used to be learned verbatim as prose.
    const turn = 'Here is what I found.\n\n<think>Let me check the git log first, then the';
    expect(stripReasoningScratchpad(turn)).toBe('Here is what I found.');
  });

  it('reports a turn that was nothing but scratchpad as having no answer', () => {
    const turn = '<think>The commits show 7778e5cd9 Fixes. Let me verify what is on the branch.</think>';
    expect(stripReasoningScratchpad(turn)).toBe('');
  });

  it('handles several blocks and the alternate tag spellings', () => {
    const turn = '<thinking>first</thinking>Step one is done. <think>second</think>Step two is next.';
    expect(stripReasoningScratchpad(turn)).toBe('Step one is done. Step two is next.');
  });

  it('leaves a normal answer untouched', () => {
    const turn = 'The deployment finished and every health check passed on the first attempt.';
    expect(stripReasoningScratchpad(turn)).toBe(turn);
  });

  it('does not eat ordinary prose that merely mentions thinking', () => {
    const turn = 'I think the retry budget is too low, so the worker gives up before the queue drains.';
    expect(stripReasoningScratchpad(turn)).toBe(turn);
  });
});
