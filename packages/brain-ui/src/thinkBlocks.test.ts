import { describe, expect, it } from 'vitest';
import { splitThinkSegments } from './thinkBlocks';

describe('splitThinkSegments', () => {
  it('separates model reasoning from the answer without exposing control tags', () => {
    expect(splitThinkSegments('<think>Inspect the model.</think>\nThe answer.')).toEqual([
      { kind: 'thought', content: 'Inspect the model.' },
      { kind: 'answer', content: 'The answer.' },
    ]);
  });

  it('keeps an unclosed streaming block as visible thought content', () => {
    expect(splitThinkSegments('<THINK>Still reasoning…')).toEqual([
      { kind: 'thought', content: 'Still reasoning…' },
    ]);
  });

  it('leaves ordinary Markdown unchanged', () => {
    expect(splitThinkSegments('  **Normal answer**\n')).toEqual([
      { kind: 'answer', content: '  **Normal answer**\n' },
    ]);
  });
});
