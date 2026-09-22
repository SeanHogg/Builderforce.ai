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
  chatRosterFromParticipants,
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

    /**
     * Chat #113 filed twelve tickets and assigned nobody. Work mode's dispatch bullet
     * described the MECHANISM (read `autoRun`, call dispatch) without ever saying that
     * the workspace's agents are the people the work belongs to.
     */
    it('names the team as the people the work belongs to', () => {
      const d = chatWorkDirective(7);
      expect(d).toContain('STAFF WITH THE TEAM');
      expect(d).toContain('builtin_chats_list_agents');
      expect(d).toContain('builtin_cloud_agents_list_mine');
      expect(d).toMatch(/never leave a ticket with no agent on it/i);
    });

    it('asks a delegating surface to do its own slices IN an agent\'s persona', () => {
      const d = chatWorkDirective(7, { canDelegate: true });
      expect(d).toContain('spawn_agent with as_agent=');
      expect(d).toMatch(/work nobody owns/i);
    });

    it('never names spawn_agent on a surface that lacks it', () => {
      // A tool named in the prompt but absent from the catalog is the
      // "narrated but never advertised" failure by construction: the model writes the
      // call it was told to make and nothing executes. The web Brain has no sub-agents.
      expect(chatWorkDirective(7)).not.toContain('spawn_agent');
      expect(chatWorkDirective(7, { canEditHere: true })).not.toContain('spawn_agent');
      expect(chatModeDirective('work', 7, { canDelegate: true })).toContain('spawn_agent');
    });

    it('tells the model to read a refusal rather than retry it', () => {
      // The measured turn retried the identical dispatch after a refusal, twice.
      expect(chatWorkDirective(7)).toMatch(/do not retry the same dispatch/i);
    });
  });

  /**
   * Chat #103: three agents (Bob, John, the Manager) were invited into an IDE chat and
   * the session made every code change itself — staffing summary `1 ticket filed ·
   * 0 dispatched`, with ZERO dispatch ATTEMPTS. Not a refusal: the model never asked,
   * because `canEditHere` told it to do the work here and nothing told it there was
   * anybody to hand it to.
   *
   * An invited agent is a human's statement about who owns the work, so it outranks a
   * rule about what this session is capable of.
   */
  describe('a chat that has been STAFFED', () => {
    const roster = [
      { ref: 'd02ff7ee-9cf2-4c44-8558-c89104f6278f', name: 'Bob', role: 'participant' },
      { ref: '658608ba-59ab-4ec3-873d-211a89ea000f', name: 'John' },
    ];

    it('names the agents AND their refs, so dispatching costs no discovery call', () => {
      const d = chatWorkDirective(7, { roster });
      expect(d).toContain('THE AGENTS IN THIS CHAT');
      expect(d).toContain('Bob');
      expect(d).toContain('John');
      // The name is what the model reads; the ref is what dispatch_agent takes. Printing
      // one without the other leaves it guessing at the argument.
      expect(d).toContain('d02ff7ee-9cf2-4c44-8558-c89104f6278f');
      expect(d).toContain('658608ba-59ab-4ec3-873d-211a89ea000f');
      expect(d).toContain('participant');
    });

    it('INVERTS the do-it-here ordering when the surface also holds file tools', () => {
      // This is the chat #103 configuration exactly: an IDE session with the workspace
      // AND agents in the chat. Before, the do-it-here bullet won unconditionally.
      const d = chatWorkDirective(7, { canEditHere: true, roster });
      expect(d).toContain('DISPATCH TO THEM');
      expect(d).not.toMatch(/DO IT HERE WHEN YOU CAN/);
      expect(d).toMatch(/not a fallback/i);
      // The file tools are not taken away — they are re-aimed at what dispatch cannot do.
      expect(d).toMatch(/keep them for what dispatch cannot cover/i);
    });

    it('keeps do-it-here for an IDE chat nobody has staffed — the case it was written for', () => {
      const d = chatWorkDirective(7, { canEditHere: true, roster: [] });
      expect(d).toMatch(/DO IT HERE WHEN YOU CAN/);
      expect(d).not.toContain('DISPATCH TO THEM');
      // And it says WHY, so the rule does not read as a preference for working alone.
      expect(d).toMatch(/No agent has been invited into this chat/i);
    });

    it('points the model at what already ran before it claims work is under way', () => {
      // The transcript records what was SAID about the work. Only the run history records
      // what executed, and the two are routinely different.
      expect(chatWorkDirective(7)).toContain('builtin_chats_runs');
      expect(chatWorkDirective(7)).toMatch(/nothing was ever dispatched/i);
    });
  });

  /**
   * One roster, derived from the participants the composer already renders — so the
   * agents a user can @-mention are exactly the agents the run is told it may dispatch
   * to. Two derivations is how those two lists come to disagree.
   */
  describe('chatRosterFromParticipants', () => {
    it('keeps the agents and drops the humans', () => {
      expect(chatRosterFromParticipants([
        { kind: 'agent', ref: 'a1', name: 'Bob' },
        { kind: 'human', ref: 'u1', name: 'Sean' },
        { kind: 'agent', ref: 'manager-t1', name: 'Manager' },
      ])).toEqual([
        { ref: 'a1', name: 'Bob' },
        { ref: 'manager-t1', name: 'Manager' },
      ]);
    });

    it('falls back to the ref rather than rendering a nameless agent', () => {
      expect(chatRosterFromParticipants([{ kind: 'agent', ref: 'a1', name: '' }]))
        .toEqual([{ ref: 'a1', name: 'a1' }]);
    });

    it('treats an unresolved roster as nobody named, not as an empty team', () => {
      // A host that has not loaded participants yet must not be able to assert there are
      // no agents — that assertion flips the whole ordering above.
      expect(chatRosterFromParticipants(undefined)).toEqual([]);
      expect(chatWorkDirective(7, { canEditHere: true, roster: chatRosterFromParticipants(undefined) }))
        .toMatch(/DO IT HERE WHEN YOU CAN/);
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
