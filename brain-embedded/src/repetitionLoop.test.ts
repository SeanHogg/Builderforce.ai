import { describe, it, expect } from 'vitest';
import { detectRepetitionLoop } from './repetitionLoop';

// The sentence chat #105 repeated until the user pressed Stop.
const LOOPED = "I'll start by checking this chat's linked tickets and locating the Room bubble plus Brain Chat scroll code. ";

describe('detectRepetitionLoop', () => {
  it('catches a sentence written back to back and keeps everything before the loop plus one copy', () => {
    const intro = 'I have both files. Next:\n';
    const loop = detectRepetitionLoop(intro + LOOPED.repeat(4));
    expect(loop).not.toBeNull();
    expect(loop!.block).toBe(LOOPED);
    expect(loop!.copies).toBe(4);
    expect(loop!.kept).toBe(intro + LOOPED);
  });

  it('catches the loop wherever in the block the stream currently is', () => {
    const text = LOOPED.repeat(3) + LOOPED.slice(0, 30);
    const loop = detectRepetitionLoop(text);
    expect(loop).not.toBeNull();
    expect(loop!.kept).toBe(LOOPED);
  });

  it('lets a sentence said twice through — that is emphasis, not a loop', () => {
    expect(detectRepetitionLoop(LOOPED.repeat(2))).toBeNull();
  });

  it('ignores a repeated divider, which has no words in it', () => {
    expect(detectRepetitionLoop('─'.repeat(400))).toBeNull();
  });

  it('never judges code inside an open fence', () => {
    const line = "  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();\n";
    expect(detectRepetitionLoop('Here are the assertions:\n```ts\n' + line.repeat(4))).toBeNull();
  });

  it('still catches a loop that starts after a closed code fence', () => {
    expect(detectRepetitionLoop('```ts\nconst a = 1;\n```\n' + LOOPED.repeat(3))).not.toBeNull();
  });

  it('lets a list of similar but different items through', () => {
    const list = Array.from({ length: 12 }, (_, i) => `- Step ${i + 1}: read the file and record what it says about the room.\n`).join('');
    expect(detectRepetitionLoop(list)).toBeNull();
  });
});
