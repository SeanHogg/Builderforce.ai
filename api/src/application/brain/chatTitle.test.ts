import { describe, it, expect } from 'vitest';
import { CHAT_TITLE_MAX_LENGTH, DEFAULT_CHAT_TITLE, normalizeChatTitle } from './chatTitle';

describe('normalizeChatTitle', () => {
  it('trims and keeps a normal title', () => {
    expect(normalizeChatTitle('  Fix the login bug  ')).toBe('Fix the login bug');
  });

  it('falls back to the default when blank or absent', () => {
    expect(normalizeChatTitle('   ')).toBe(DEFAULT_CHAT_TITLE);
    expect(normalizeChatTitle(undefined)).toBe(DEFAULT_CHAT_TITLE);
    expect(normalizeChatTitle(null)).toBe(DEFAULT_CHAT_TITLE);
  });

  it('keeps a title exactly at the column width', () => {
    const exact = 'a'.repeat(CHAT_TITLE_MAX_LENGTH);
    expect(normalizeChatTitle(exact)).toBe(exact);
  });

  it('clamps an over-long title to the varchar(500) column — the PATCH /chats/:id 500', () => {
    const out = normalizeChatTitle('x'.repeat(2000));
    expect(Array.from(out)).toHaveLength(CHAT_TITLE_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('counts code points, never splitting an emoji into a lone surrogate', () => {
    const out = normalizeChatTitle('🚀'.repeat(600));
    const chars = Array.from(out);
    expect(chars).toHaveLength(CHAT_TITLE_MAX_LENGTH);
    expect(chars.slice(0, -1).every((c) => c === '🚀')).toBe(true);
  });
});
