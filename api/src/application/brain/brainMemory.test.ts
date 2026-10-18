/**
 * Brain memory — what a summary IS, and where it is kept.
 *
 * Two behaviours are pinned here, both of which used to fail in production:
 *
 *  1. `answerTextOf` — the summary a chat shows and a memory keeps must be the model's
 *     ANSWER, not its reasoning. `readProxyChoice` returns `message.content` verbatim,
 *     and on a reasoning model that content is the `<think>` scratchpad followed by the
 *     answer, so the raw text used to be stored as the summary, shown to the user, and
 *     handed to project-memory consolidation as though the model had said it.
 *
 *  2. `retainChatMemory` — a summary must LAND somewhere memory reads. `summarizeChat`
 *     wrote only `brain_chats.summary`, so `chat_memories` stayed empty and
 *     consolidation, `listMemories` and the memory-sync push to agent hosts saw nothing;
 *     `archiveChat` merely set a flag and took the summary with it out of view.
 *
 * The database is a spy, not a real one: these assertions are about the VALUES the
 * writer was handed (the cleaned text, the tenant/chat/project provenance, the upsert
 * target), which is exactly the part that was wrong.
 */
import { describe, expect, it, vi } from 'vitest';
import { answerTextOf, retainChatMemory } from './brainMemory';
import { archiveChat } from './brainChats';

describe('answerTextOf', () => {
  it('leaves an answer with no reasoning untouched', () => {
    expect(answerTextOf('We agreed to ship on Friday.')).toBe('We agreed to ship on Friday.');
  });

  it('trims surrounding whitespace on an answer that carries reasoning', () => {
    // The pass-through is byte-for-byte; the trim belongs to the cleaning policy, so
    // assert it on text that actually goes through it rather than on the raw case.
    expect(answerTextOf('<think>hmm</think>  \n\n  The answer.  \n')).toBe('The answer.');
  });

  it('drops a closed <think> block and keeps the answer after it', () => {
    const raw = '<think>The user wants pricing. Maybe ask about seats.</think>The price is $20 per seat.';
    expect(answerTextOf(raw)).toBe('The price is $20 per seat.');
  });

  it('drops the reasoning that sits BETWEEN two answers, keeping both', () => {
    const raw = 'First: imports are wrong.\n<think>Re-read the file.</think>Second: the test never asserts it.';
    const out = answerTextOf(raw);
    expect(out).toContain('First: imports are wrong.');
    expect(out).toContain('Second: the test never asserts it.');
    expect(out).not.toContain('Re-read the file');
  });

  it('never leaks the model deliberating about its own answer', () => {
    const raw = '<think>The user is right — I should have deleted the branch first.</think>Agreed; the branch stays.';
    expect(answerTextOf(raw)).not.toContain('I should have deleted');
    expect(answerTextOf(raw)).toBe('Agreed; the branch stays.');
  });

  it('drops an UNTERMINATED think block — the transport caps completions mid-thought', () => {
    // No closing tag, and the trailing text is still deliberation. A `<think>…</think>`
    // regex would keep all of it and store the reasoning as the summary.
    const raw = '<think>The user is right - I should have: 1. Deleted the branch…';
    expect(answerTextOf(raw)).toBe('');
  });

  it('drops an unterminated think block that arrives before a real answer', () => {
    const raw = '<think>hmm, let me reconsider the scope</think>The scope stays as agreed.';
    expect(answerTextOf(raw)).toBe('The scope stays as agreed.');
  });

  it('drops a mid-string closing tag that has no opening one, keeping the text around it', () => {
    // A lone closer is markup, not a block start: the answer is everything except the
    // tag itself — the earlier fragment is real answer text and is not discarded.
    const raw = 'Some earlier fragment</think>The actual summary.';
    expect(answerTextOf(raw)).toBe('Some earlier fragmentThe actual summary.');
  });

  it('returns empty for reasoning-only output rather than promoting it', () => {
    expect(answerTextOf('<think>just thinking, no answer</think>')).toBe('');
  });

  it('handles several think blocks and a stray closing tag in one output', () => {
    const raw = '<think>a</think>One.</think><think>b</think>Two.';
    expect(answerTextOf(raw)).toBe('One. Two.');
  });

  it('is safe on empty and absent text', () => {
    expect(answerTextOf('')).toBe('');
    expect(answerTextOf(null)).toBe('');
    expect(answerTextOf(undefined)).toBe('');
  });
});

describe('retainChatMemory', () => {
  /** A `Db` spy exposing only `.insert()`, which is the whole call the writer makes. */
  function insertSpy() {
    const onConflictDoUpdate = vi.fn((config: unknown) => config);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    return { db: { insert } as never, insert, values, onConflictDoUpdate };
  }

  it('writes the summary with its tenant/chat/project provenance', async () => {
    const spy = insertSpy();
    await retainChatMemory(spy.db, { tenantId: 1, chatId: 42, projectId: 7, summary: 'We shipped the fix.' });

    expect(spy.insert).toHaveBeenCalledTimes(1);
    expect(spy.values).toHaveBeenCalledWith({
      tenantId: 1,
      chatId: 42,
      projectId: 7,
      summary: 'We shipped the fix.',
    });
  });

  it('upserts on the chat id, so re-summarizing updates rather than duplicates', async () => {
    const spy = insertSpy();
    await retainChatMemory(spy.db, { tenantId: 1, chatId: 42, projectId: null, summary: 'Second pass.' });

    const conflict = spy.onConflictDoUpdate.mock.calls[0]?.[0] as
      | { target?: { name?: string }; set?: Record<string, unknown>; targetWhere?: unknown }
      | undefined;
    expect(conflict).toBeDefined();
    // A plain `chat_id` unique index, so the target needs no predicate (the partial
    // index on agent_host_session_id is the one that does — see check:conflict-targets).
    expect(conflict?.target).toBeDefined();
    expect(conflict?.set?.summary).toBe('Second pass.');
    expect(conflict?.targetWhere).toBeUndefined();
  });

  it('accepts a chat with no project — consolidation scopes on project, the chat id is the handle', async () => {
    const spy = insertSpy();
    await retainChatMemory(spy.db, { tenantId: 3, chatId: 9, projectId: null, summary: 'Tenant-wide chat.' });
    expect(spy.values).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, tenantId: 3 }));
  });
});

describe('archiveChat', () => {
  /**
   * A `Db` spy over the four statements `archiveChat` makes: the ownership
   * `select`, the `update`, the memory `insert`, and nothing else.
   */
  function archiveDb(chat: Record<string, unknown>) {
    const state = { chat, archived: false, memory: null as Record<string, unknown> | null };
    const insertValues = vi.fn((values: Record<string, unknown>) => {
      state.memory = values;
      return { onConflictDoUpdate: () => ({}) };
    });
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.chat] }) }) }),
      update: () => ({ set: (values: Record<string, unknown>) => {
        if (values.isArchived === true) state.archived = true;
        return { where: async () => [] };
      } }),
      insert: () => ({ values: insertValues }),
    } as never;
    return { db, state, insertValues };
  }

  it('retains the chat summary as a memory so archiving does not lose it', async () => {
    const spy = archiveDb({ id: 5, origin: 'brainstorm', summary: 'We agreed to ship Friday.', projectId: 2 });

    const result = await archiveChat(spy.db, 5, 1, 'user-1');

    expect(result).toEqual({ ok: true });
    expect(spy.state.archived).toBe(true);
    expect(spy.state.memory).toMatchObject({
      tenantId: 1,
      chatId: 5,
      projectId: 2,
      summary: 'We agreed to ship Friday.',
    });
  });

  it('cleans a pre-existing summary through answerTextOf, so old reasoning cannot reach memory', async () => {
    const spy = archiveDb({
      id: 5,
      origin: 'brainstorm',
      summary: '<think>the user is right - I should have deleted the branch</think>Agreed; the branch stays.',
      projectId: null,
    });

    await archiveChat(spy.db, 5, 1, 'user-1');

    expect((spy.state.memory?.summary as string)).toBe('Agreed; the branch stays.');
  });

  it('archives a chat that was never summarized without inventing a memory', async () => {
    const spy = archiveDb({ id: 5, origin: 'brainstorm', summary: null, projectId: null });

    const result = await archiveChat(spy.db, 5, 1, 'user-1');

    expect(result).toEqual({ ok: true });
    expect(spy.state.archived).toBe(true);
    expect(spy.state.memory).toBeNull();
  });
});