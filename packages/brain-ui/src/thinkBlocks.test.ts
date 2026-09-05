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


  it('leaves a short but COMPLETE answer alone, however long the reasoning', () => {
    // "Done." is a reply. Promoting the reasoning over it would dump the model's
    // scratchpad on the user for every terse confirmation.
    const long = 'x'.repeat(400);
    expect(splitThinkSegments(`<think>${long}</think>
Done.`)).toEqual([
      { kind: 'thought', content: long },
      { kind: 'answer', content: 'Done.' },
    ]);
  });

  it('rescues an answer the model sealed inside the think block', () => {
    // Verbatim shape from a real run: the reply was inside <think> and the only text
    // after the closing tag was the tail of its own sentence, so the user saw
    // "/task number?" as the entire response.
    const reply = '"Fix" is too vague - I need to know what to fix. Could you specify a file, or a ticket';
    const out = splitThinkSegments(`<think>${reply}</think>

/task number?`);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('answer');
    expect(out[0].content).toBe(`${reply} /task number?`);
  });

  it('does not promote reasoning that is still streaming with no answer yet', () => {
    // No answer segment at all is a block mid-stream, not a swallowed reply.
    expect(splitThinkSegments('<think>Still reasoning about the layout')).toEqual([
      { kind: 'thought', content: 'Still reasoning about the layout' },
    ]);
  });

  it('keeps a fragment as-is when there is no richer thought to promote', () => {
    expect(splitThinkSegments('<think>ok</think>\n/task number?')).toEqual([
      { kind: 'thought', content: 'ok' },
      { kind: 'answer', content: '/task number?' },
    ]);
  });

  it('treats a markdown-led short answer as a real reply', () => {
    const long = 'y'.repeat(200);
    const out = splitThinkSegments(`<think>${long}</think>
- Yes`);
    expect(out.map((s) => s.kind)).toEqual(['thought', 'answer']);
    expect(out[1].content).toBe('- Yes');
  });

  it('leaves ordinary Markdown unchanged', () => {
    expect(splitThinkSegments('  **Normal answer**\n')).toEqual([
      { kind: 'answer', content: '  **Normal answer**\n' },
    ]);
  });
});
