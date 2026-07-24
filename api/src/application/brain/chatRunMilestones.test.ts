import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ChatTicketService.postRunMilestone — the delivery half of "the human driving the
 * chat is notified on execution". A run milestone must become a durable
 * `brain_chat_messages` row in EVERY non-archived chat the ticket is linked to,
 * followed by a `broadcastBrainChatChanged` push — the DO `changed` frame that makes
 * a mounted web or VSIX Brain (both subscribe via subscribeToChatMessages) re-read
 * the transcript and render the update live.
 *
 * Also proves: per-execution+phase idempotency via eventKey (`run:{id}:{phase}`),
 * the approval-id nonce for repeatable phases (paused/resumed once per Q&A cycle),
 * the ask_human question surfacing in the paused line, and the never-throws contract.
 */

const { broadcasts } = vi.hoisted(() => ({
  broadcasts: [] as Array<{ tenantId: number; chatId: number }>,
}));
vi.mock('../../infrastructure/relay/broadcastRoom', () => ({
  broadcastBrainChatChanged: vi.fn(async (_room: unknown, tenantId: number, chatId: number) => {
    broadcasts.push({ tenantId, chatId });
  }),
}));

import { ChatTicketService, ticketKindForTaskType } from './ChatTicketService';

interface InsertedRow { chatId: number; content: string; eventKey: string | null; metadata: string | null; role: string }

let linkedChats: Array<Record<string, unknown>> = [];
let inserted: InsertedRow[] = [];
/** When true the insert reports a conflict (duplicate eventKey) — returning []. */
let insertConflicts = false;

/** Operation-typed fake of the Drizzle chains ChatTicketService actually uses. */
function makeDb() {
  let nextId = 1000;
  const selectBuilder = (result: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) b[m] = () => b;
    (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(result);
    return b;
  };
  return {
    select: () => selectBuilder(linkedChats),
    insert: () => ({
      values: (v: InsertedRow) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (insertConflicts) return [];
            inserted.push(v);
            return [{ id: ++nextId }];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

function makeService() {
  return new ChatTicketService(makeDb() as never, { SESSION_ROOM: {} } as never);
}

function chatRow(chatId: number, over: Record<string, unknown> = {}) {
  return {
    chatId, title: 'chat', projectId: 3, isArchived: false, mergedIntoChatId: null,
    createdAt: new Date(), updatedAt: new Date(), linkType: 'created', ...over,
  };
}

beforeEach(() => {
  linkedChats = [];
  inserted = [];
  broadcasts.length = 0;
  insertConflicts = false;
});

describe('postRunMilestone → linked Brain chats', () => {
  it('lands one message per linked chat AND broadcasts the changed frame each mounted Brain re-reads', async () => {
    linkedChats = [chatRow(11), chatRow(12)];
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'completed', executionId: 42,
      toStatus: 'in_review', resultText: 'Shipped', agentName: 'Dev Agent',
    });
    expect(inserted).toHaveLength(2);
    expect(inserted.map((r) => r.chatId).sort()).toEqual([11, 12]);
    expect(inserted[0]!.role).toBe('assistant');
    expect(inserted[0]!.content).toContain('finished task #7');
    expect(inserted[0]!.content).toContain('in review');
    expect(inserted[0]!.eventKey).toBe('run:42:completed');
    expect(broadcasts).toEqual([
      { tenantId: 1, chatId: 11 },
      { tenantId: 1, chatId: 12 },
    ]);
  });

  it('skips archived and merged chats (no ghost notifications)', async () => {
    linkedChats = [chatRow(11), chatRow(12, { isArchived: true }), chatRow(13, { mergedIntoChatId: 99 })];
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'started', executionId: 42, agentName: 'Dev Agent',
    });
    expect(inserted.map((r) => r.chatId)).toEqual([11]);
  });

  it('is idempotent: a duplicate eventKey inserts nothing and broadcasts nothing', async () => {
    linkedChats = [chatRow(11)];
    insertConflicts = true;
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'started', executionId: 42, agentName: 'Dev Agent',
    });
    expect(inserted).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('surfaces the ask_human QUESTION in the paused line, keyed per approval (nonce)', async () => {
    linkedChats = [chatRow(11)];
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'paused', executionId: 42, agentName: 'Dev Agent',
      questionText: 'Which environment should I deploy to?', eventNonce: 'appr-9',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.content).toContain('Which environment should I deploy to?');
    expect(inserted[0]!.eventKey).toBe('run:42:paused:appr-9');
  });

  it('narrates `resumed` after the human answers, keyed by the same approval cycle', async () => {
    linkedChats = [chatRow(11)];
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'resumed', executionId: 42, agentName: 'Dev Agent',
      eventNonce: 'appr-9',
    });
    expect(inserted[0]!.content).toContain('resumed work on task #7');
    expect(inserted[0]!.eventKey).toBe('run:42:resumed:appr-9');
  });

  it('narrates `failed` with the reason (orphan reaper wording flows through)', async () => {
    linkedChats = [chatRow(11)];
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'failed', executionId: 42, agentName: 'Dev Agent',
      errorMessage: 'Execution timed out — the agent did not report completion.',
    });
    expect(inserted[0]!.content).toContain('failed');
    expect(inserted[0]!.content).toContain('Execution timed out');
  });

  it('does nothing for an unlinked ticket or an invalid kind', async () => {
    await makeService().postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'started', executionId: 42, agentName: 'Dev Agent',
    });
    await makeService().postRunMilestone(1, {
      kind: 'sprint', ref: '7', phase: 'started', executionId: 42, agentName: 'Dev Agent',
    });
    expect(inserted).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('never throws into the caller when the chat write fails (a run must not break on narration)', async () => {
    linkedChats = [chatRow(11)];
    const svc = new ChatTicketService(
      {
        select: () => { throw new Error('db down'); },
        insert: () => { throw new Error('db down'); },
        update: () => { throw new Error('db down'); },
      } as never,
      { SESSION_ROOM: {} } as never,
    );
    await expect(svc.postRunMilestone(1, {
      kind: 'task', ref: '7', phase: 'started', executionId: 42, agentName: 'Dev Agent',
    })).resolves.toBeUndefined();
  });
});

describe('ticketKindForTaskType (shared kind normalizer)', () => {
  it('keeps epic/gap, folds everything else to task', () => {
    expect(ticketKindForTaskType('epic')).toBe('epic');
    expect(ticketKindForTaskType('gap')).toBe('gap');
    expect(ticketKindForTaskType('story')).toBe('task');
    expect(ticketKindForTaskType(null)).toBe('task');
    expect(ticketKindForTaskType(undefined)).toBe('task');
  });
});
