import { describe, it, expect } from 'vitest';
import { CHAT_MODES, DEFAULT_CHAT_MODE, isChatMode, normalizeChatMode, resolveChatMode } from './chatMode';

describe('server chat mode', () => {
  it('mirrors the brain-embedded vocabulary', () => {
    // The two copies exist because the api cannot import a browser bundle. They are a
    // closed two-value set, so a drift here would be a silent behaviour split.
    expect(CHAT_MODES).toEqual(['chat', 'work']);
    expect(DEFAULT_CHAT_MODE).toBe('chat');
    expect(isChatMode('work')).toBe(true);
    expect(isChatMode('workflow')).toBe(false);
  });

  it('normalize returns null for unusable input so a PATCH can leave the column alone', () => {
    // Distinct from resolve: coercing an unknown value to `chat` on WRITE would demote
    // a running execution because a stale client sent something this build lacks.
    expect(normalizeChatMode('nonsense')).toBeNull();
    expect(normalizeChatMode(undefined)).toBeNull();
    expect(normalizeChatMode('chat')).toBe('chat');
    expect(normalizeChatMode('work')).toBe('work');
  });

  it('resolves a stored value, falling back to the default', () => {
    expect(resolveChatMode({ origin: 'brainstorm', mode: 'work' })).toBe('work');
    expect(resolveChatMode({ origin: 'brainstorm', mode: 'chat' })).toBe('chat');
    expect(resolveChatMode({ origin: 'brainstorm', mode: null })).toBe('chat');
    expect(resolveChatMode({ origin: 'brainstorm' })).toBe('chat');
  });

  it('pins the singleton team and manager chats to work whatever the column says', () => {
    // These are created by get-or-create paths that never set the column, so the 0409
    // default would otherwise strip the AI Manager's ability to open or drive work.
    expect(resolveChatMode({ origin: 'team', mode: 'chat' })).toBe('work');
    expect(resolveChatMode({ origin: 'manager', mode: null })).toBe('work');
    expect(resolveChatMode({ origin: 'manager', mode: 'chat' })).toBe('work');
  });
});
