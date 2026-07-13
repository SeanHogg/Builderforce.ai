import { describe, it, expect } from 'vitest';
import {
  deriveChatTitle,
  DEFAULT_CHAT_TITLE,
  MAX_CHAT_TITLE_LENGTH,
} from './useBrainChats';

describe('deriveChatTitle', () => {
  it('uses the first non-empty line of the user message (FR1/FR2)', () => {
    expect(deriveChatTitle('Fix the CRLF edit bug\n\nmore detail here')).toBe(
      'Fix the CRLF edit bug',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(deriveChatTitle('   run   a   self-diagnostic  ')).toBe(
      'run a self-diagnostic',
    );
  });

  it('returns empty for blank input (caller keeps the placeholder — AC1 edge)', () => {
    expect(deriveChatTitle('   \n  ')).toBe('');
    expect(deriveChatTitle('')).toBe('');
  });

  it('exposes the placeholder the auto-title guard compares against', () => {
    expect(DEFAULT_CHAT_TITLE).toBe('New chat');
  });

  it('enforces AC3 max length (under 50 characters including ellipsis)', () => {
    expect(MAX_CHAT_TITLE_LENGTH).toBe(50);
    const long =
      'Please review the entire brain run store compaction logic and explain why it reverts to the opening request every time';
    const t = deriveChatTitle(long);
    // Body ≤ MAX, plus a single ellipsis character when truncated.
    expect(t.length).toBeLessThanOrEqual(MAX_CHAT_TITLE_LENGTH + 1);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/\s…$/); // trimmed before the ellipsis
    expect(t.startsWith('Please review')).toBe(true);
  });

  it('does not truncate titles already within the AC3 budget', () => {
    const short = 'Implement chat title generation';
    expect(deriveChatTitle(short)).toBe(short);
    expect(short.length).toBeLessThanOrEqual(MAX_CHAT_TITLE_LENGTH);
  });

  it('truncates exactly at the max boundary on a word when possible', () => {
    // Build a string longer than MAX that has a clear word boundary near the cut.
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo';
    expect(words.length).toBeGreaterThan(MAX_CHAT_TITLE_LENGTH);
    const t = deriveChatTitle(words);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(MAX_CHAT_TITLE_LENGTH + 1);
    // No partial word immediately before the ellipsis when a space was available.
    const body = t.slice(0, -1);
    expect(body).not.toMatch(/\s$/);
    expect(words.startsWith(body)).toBe(true);
  });

  it('ignores leading blank lines and still picks the first real topic line', () => {
    expect(deriveChatTitle('\n\n  \nShip the rename UX\nbody')).toBe('Ship the rename UX');
  });

  it('preserves short multi-word intent phrases (AC2 relevance samples)', () => {
    const samples = [
      'Debug flaky CI on task-404',
      'How do I rename a chat?',
      'Summarize the stakeholder alignment PRD',
      'Fix auto-title not firing on first message',
    ];
    for (const s of samples) {
      const t = deriveChatTitle(s);
      expect(t).toBe(s);
      expect(t.length).toBeLessThanOrEqual(MAX_CHAT_TITLE_LENGTH);
      expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(3);
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });
});
