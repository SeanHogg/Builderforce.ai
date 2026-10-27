import { describe, expect, it } from 'vitest';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { chatAsks, chatAsksDirective, chatGoalText, markPersonTurn } from './chatAsks';

const person = (content: string) => markPersonTurn({ role: 'user', content });
const reply = (content: string): ChatCompletionMessage => ({ role: 'assistant', content });

/** Chat #5739, as its runs saw it. */
const CHAT_5739: ChatCompletionMessage[] = [
  person('remove the title from the top of the VSIX'),
  reply('The circled title is InlineChatTitle.'),
  person('and you need to fix the fact that when you send a message during execution the attached images are not being sent'),
  reply('Reading the steer path.'),
  person('complete the implementation'),
  reply('Working on it.'),
  // The loop's own instruction — role user, but not the person's ask.
  { role: 'user', content: 'STOP READING. Make the change now.' },
  person('complete the implementation'),
];

describe('chatAsks', () => {
  it("lists the person's distinct asks oldest first, never the loop's own nudges", () => {
    expect(chatAsks(CHAT_5739)).toEqual([
      'remove the title from the top of the VSIX',
      'and you need to fix the fact that when you send a message during execution the attached images are not being sent',
      'complete the implementation',
    ]);
  });

  it('never carries a question — a Q&A chat gets no checklist', () => {
    const qa = [person('how does the steer path work?'), reply('…'), person('where is the header rendered?'), reply('…'), person('fix the header')];
    expect(chatAsks(qa)).toEqual(['fix the header']);
    expect(chatAsksDirective(qa)).toBeNull();
  });

  it('skips a bare directive — it carries no ask of its own', () => {
    expect(chatAsks([person('fix the header'), reply('ok'), person('go ahead')])).toEqual(['fix the header']);
  });

  it('keeps only the most recent four, each clipped', () => {
    const many = Array.from({ length: 6 }, (_, i) => person(`fix item ${i} ${'x'.repeat(400)}`));
    const asks = chatAsks(many);
    expect(asks).toHaveLength(4);
    expect(asks[0]).toMatch(/^fix item 2 /);
    expect(asks[0]!.endsWith('…')).toBe(true);
  });
});

describe('chatGoalText / chatAsksDirective', () => {
  it("states the original ask to coders handed only 'complete the implementation'", () => {
    const goal = chatGoalText(CHAT_5739);
    expect(goal.startsWith('complete the implementation')).toBe(true);
    expect(goal).toContain('1. remove the title from the top of the VSIX');
    // Context, not more work: coders are told earlier asks may be done or superseded.
    expect(goal).toContain('CONTEXT ONLY');
    expect(chatAsksDirective(CHAT_5739)).toContain('remove the title from the top of the VSIX');
  });

  it('is just the request, and no directive, in a one-ask chat', () => {
    const one = [person('remove the title from the top of the VSIX')];
    expect(chatGoalText(one)).toBe('remove the title from the top of the VSIX');
    expect(chatAsksDirective(one)).toBeNull();
  });
});
