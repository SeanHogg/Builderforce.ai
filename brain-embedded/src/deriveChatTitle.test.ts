import { describe, it, expect } from 'vitest';
import { deriveChatTitle, DEFAULT_CHAT_TITLE } from './useBrainChats';

describe('deriveChatTitle', () => {
  it('uses the first non-empty line of the user message', () => {
    expect(deriveChatTitle('Fix the CRLF edit bug\n\nmore detail here')).toBe('Fix the CRLF edit bug');
  });

  it('collapses whitespace and trims', () => {
    expect(deriveChatTitle('   run   a   self-diagnostic  ')).toBe('run a self-diagnostic');
  });

  it('truncates a long first line on a word boundary with an ellipsis', () => {
    const t = deriveChatTitle(
      'Please review the entire brain run store compaction logic and explain why it reverts to the opening request',
    );
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/\s…$/); // trimmed before the ellipsis
  });

  it('returns empty for blank input (caller keeps the placeholder)', () => {
    expect(deriveChatTitle('   \n  ')).toBe('');
    expect(deriveChatTitle('')).toBe('');
  });

  it('exposes the placeholder the auto-title guard compares against', () => {
    expect(DEFAULT_CHAT_TITLE).toBe('New chat');
  });
});
