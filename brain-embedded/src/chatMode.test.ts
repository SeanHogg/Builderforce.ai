import { describe, it, expect } from 'vitest';
import {
  CHAT_MODES,
  DEFAULT_CHAT_MODE,
  isChatMode,
  normalizeChatMode,
  chatModeDirective,
  chatConversationDirective,
  chatWorkDirective,
} from './chatMode';

describe('chat mode vocabulary', () => {
  it('defaults to conversation, not execution', () => {
    // The whole point of the split: asking a question must never be the thing that
    // opens a ticket. A default of `work` would reinstate the defect.
    expect(DEFAULT_CHAT_MODE).toBe('chat');
  });

  it('accepts only the known modes', () => {
    expect(CHAT_MODES).toEqual(['chat', 'work']);
    expect(isChatMode('chat')).toBe(true);
    expect(isChatMode('work')).toBe(true);
    expect(isChatMode('Work')).toBe(false);
    expect(isChatMode(undefined)).toBe(false);
  });

  it('resolves an unknown/absent value to a conversation', () => {
    // Fail SAFE: a client ahead of the server, or a row written before 0409, must not
    // be granted execution authority by accident.
    expect(normalizeChatMode(null)).toBe('chat');
    expect(normalizeChatMode('executive')).toBe('chat');
    expect(normalizeChatMode(7)).toBe('chat');
    expect(normalizeChatMode('work')).toBe('work');
  });
});

describe('chatModeDirective', () => {
  it('chat mode forbids minting board work but keeps the explicit-request escape hatch', () => {
    const d = chatModeDirective('chat', 42);
    expect(d).toContain('MODE: CHAT');
    expect(d).toMatch(/Do NOT create/i);
    // Without the escape hatch a user who explicitly says "open a ticket for that" is
    // refused by their own default, which reads as the assistant being broken.
    expect(d).toMatch(/explicitly asks/i);
    // It must NOT carry the work-linking contract.
    expect(d).not.toContain('builtin_chats_link_ticket');
  });

  it('work mode carries the linking contract AND the dispatch obligation', () => {
    const d = chatModeDirective('work', 42);
    expect(d).toContain('MODE: WORK');
    expect(d).toContain('Brain chat #42');
    expect(d).toContain('builtin_chats_link_ticket');
    // Dispatch is what makes Work mean execution rather than paperwork.
    expect(d).toContain('builtin_chats_dispatch_agent');
    expect(d).toContain('autoRun');
  });

  it('names tools by their ADVERTISED gateway names, never catalog ids', () => {
    // A prompt that prints `chats.dispatch_agent` hands the model a string that appears
    // nowhere in its tool list, and the failure is silent in both directions.
    const d = chatWorkDirective(1);
    for (const catalogId of ['chats.dispatch_agent', 'cloud_agents.list_mine', 'tasks.assignees']) {
      const advertised = `builtin_${catalogId.replace(/[^a-zA-Z0-9]+/g, '_')}`;
      expect(d).toContain(advertised);
      expect(d).not.toContain(` ${catalogId}`);
    }
  });

  it('the two directives are genuinely different instructions', () => {
    expect(chatConversationDirective()).not.toEqual(chatWorkDirective(1));
  });
});
