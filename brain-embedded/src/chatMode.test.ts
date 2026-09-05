import { describe, it, expect } from 'vitest';
import {
  CHAT_MODES,
  NEW_CHAT_MODE,
  RESTING_CHAT_MODE,
  isChatMode,
  normalizeChatMode,
  chatModeDirective,
  chatConversationDirective,
  chatWorkDirective,
} from './chatMode';

describe('chat mode vocabulary', () => {
  it('opens a NEW conversation in work, and rests an unreadable one in chat', () => {
    // The two answers are deliberately different. A new conversation opens in Work
    // because that is what the product is for; an unset/unknown STORED value must
    // still resolve to a conversation, so a row that never opted in is never armed.
    expect(NEW_CHAT_MODE).toBe('work');
    expect(RESTING_CHAT_MODE).toBe('chat');
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

  /**
   * "Finish by dispatching" is right on the web Brain, which has no file tools and can
   * only get code changed by asking someone else. On the IDE surface, read as an
   * unconditional rule, it sent the agent to hire a remote builder for a one-line fix in
   * the workspace it already had open — a whole turn spent on the dispatch, file
   * untouched. So the precedence is stated only where the session can actually act.
   */
  describe('doing the work yourself vs. handing it off', () => {
    it('tells a session WITH file tools to make the change itself first', () => {
      const d = chatWorkDirective(7, { canEditHere: true });
      expect(d).toMatch(/DO IT HERE WHEN YOU CAN/);
      expect(d).toMatch(/workspace file tools/);
      // Doing it yourself never replaces recording it — that is the linking contract.
      expect(d).toContain('builtin_chats_dispatch_agent');
    });

    it('says nothing of the sort where there are no file tools', () => {
      const d = chatWorkDirective(7);
      expect(d).not.toMatch(/DO IT HERE WHEN YOU CAN/);
      // The web Brain's only route to a code change is still the dispatch.
      expect(d).toContain('builtin_chats_dispatch_agent');
    });

    it('names the steering tool, so a dispatched agent can be directed', () => {
      // Advertised automatically because the prompt names it (see `toolNamesMentionedIn`),
      // which is what makes "dispatch and then direct them" reachable in one turn.
      expect(chatWorkDirective(7)).toContain('builtin_executions_post_message');
    });

    it('tells the model to read a refusal rather than retry it', () => {
      // The measured turn retried the identical dispatch after a refusal, twice.
      expect(chatWorkDirective(7)).toMatch(/do not retry the same dispatch/i);
    });
  });

  it('names tools by their ADVERTISED gateway names, never catalog ids', () => {
    // A prompt that prints `chats.dispatch_agent` hands the model a string that appears
    // nowhere in its tool list, and the failure is silent in both directions.
    const d = chatWorkDirective(1);
    for (const catalogId of ['chats.dispatch_agent', 'cloud_agents.list_mine', 'tasks.assignees', 'executions.post_message']) {
      const advertised = `builtin_${catalogId.replace(/[^a-zA-Z0-9]+/g, '_')}`;
      expect(d).toContain(advertised);
      expect(d).not.toContain(` ${catalogId}`);
    }
  });

  it('the two directives are genuinely different instructions', () => {
    expect(chatConversationDirective()).not.toEqual(chatWorkDirective(1));
  });
});
