import { describe, it, expect } from 'vitest';
import { chatSwitcherLabel } from './chatSwitcherLabel';

describe('chatSwitcherLabel', () => {
  it('is just the title when the chat has no linked tickets', () => {
    expect(chatSwitcherLabel({ title: 'Untitled session', id: 12 })).toBe('Untitled session');
  });

  it('prefixes ticket count and progress so a return is obvious', () => {
    expect(
      chatSwitcherLabel({
        title: 'when a user loses internet connection',
        id: 2546,
        ticketCount: 6,
        ticketProgressPct: 67,
      }),
    ).toBe('6 tickets · 67% · when a user loses internet connection');
  });

  it('keeps the live-run glyph in front of the percent', () => {
    expect(
      chatSwitcherLabel({
        title: 'review the Roadmap.md file',
        id: 1,
        ticketCount: 3,
        ticketProgressPct: 50,
        runGlyph: '● ',
      }),
    ).toBe('● 3 tickets · 50% · review the Roadmap.md file');
  });

  it('adds open/done counts when the server sent them', () => {
    expect(
      chatSwitcherLabel({ title: 'ship it', id: 3, ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: 3, ticketDoneCount: 5 }),
    ).toBe('8 tickets · 62% · 3 open · 5 done · ship it');
  });

  it('treats absent open/done as unknown, not zero', () => {
    expect(chatSwitcherLabel({ title: 'ship it', id: 3, ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: 3 })).toBe(
      '8 tickets · 62% · ship it',
    );
  });

  it('falls back to Chat <id> when the title is blank', () => {
    expect(chatSwitcherLabel({ title: '  ', id: 9, ticketCount: 1, ticketProgressPct: 0 })).toBe(
      '1 tickets · 0% · Chat 9',
    );
  });
});
