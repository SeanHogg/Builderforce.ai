import { describe, expect, it } from 'vitest';
import { isRestatedReply, previousReplyText, RESTATED_MIN_WORDS } from './restatedReply';
import type { ChatCompletionMessage } from './streamChatCompletion';

/** Chat #126 ended turn after turn on the same "not complete" summary. */
const STATUS = Array.from({ length: 8 }, (_, i) =>
  `W${i + 1} is not complete because the blueprint detectors still fail the api typecheck on file number ${i}.`,
).join(' ');

describe('isRestatedReply', () => {
  it('catches the previous status given again', () => {
    expect(isRestatedReply(STATUS, STATUS)).toBe(true);
  });

  it('still catches it with one new line appended', () => {
    expect(isRestatedReply(`${STATUS} Also I re-read the roadmap.`, STATUS)).toBe(true);
  });

  it('passes a reply that reports new progress', () => {
    const fresh = Array.from({ length: 10 }, (_, i) => `Fixed detector ${i} by importing the connection module and aligning enum value ${i}.`).join(' ');
    expect(isRestatedReply(fresh, STATUS)).toBe(false);
  });

  it('never judges a short reply', () => {
    const short = 'Done. All tests pass.';
    expect(short.split(' ').length).toBeLessThan(RESTATED_MIN_WORDS);
    expect(isRestatedReply(short, short)).toBe(false);
  });

  it('never judges the first turn', () => {
    expect(isRestatedReply(STATUS, '')).toBe(false);
  });
});

describe('previousReplyText', () => {
  it("returns the assistant's answer to the PREVIOUS user turn", () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'user', content: 'implement the PRD' },
      { role: 'assistant', content: 'old status' },
      { role: 'user', content: 'continue' },
    ];
    expect(previousReplyText(convo)).toBe('old status');
  });

  it('is empty on the first turn', () => {
    expect(previousReplyText([{ role: 'user', content: 'hi' }])).toBe('');
  });
});
