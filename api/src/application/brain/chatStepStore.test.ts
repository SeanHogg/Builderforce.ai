import { describe, expect, it, vi } from 'vitest';

vi.mock('./chatCacheVersions', () => ({ bumpChatMessages: async () => undefined, bumpUnreadForChatAudience: async () => undefined }));
const { appendSteps } = vi.hoisted(() => ({
  appendSteps: vi.fn(async (_db: unknown, _tenantId: number, _chatId: number, steps: Array<{ metadata: string; eventKey?: string | null; createdAt?: Date }>) =>
    steps.map((s, i) => ({ id: 1_000_000_000_000 + i, role: 'tool', content: '', metadata: s.metadata, seq: 0, createdAt: new Date(0) }))),
}));
vi.mock('./chatStepStore', async (importOriginal) => ({ ...(await importOriginal<object>()), appendSteps }));

import { brainChatMessages } from '../../infrastructure/database/schema';
import { appendRaw } from './brainMessageStore';
import { anchorStepSeqs, interleaveByTime, isStepId } from './chatStepStore';
import type { BrainChatMessageRow } from './brainChatShapes';

const STEP = '{"kind":"step","category":"tool","label":"read_file","args":{"path":"a.ts"}}';

/** A drizzle stand-in recording what reached `brain_chat_messages`. */
function fakeDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ tenantId: 1 }] }) }) }),
    insert: (table: unknown) => ({
      values: (rows: Array<Record<string, unknown>>) => {
        if (table === brainChatMessages) inserted.push(...rows);
        return {
          onConflictDoNothing: () => ({
            returning: async () => rows.map((r, i) => ({ id: i + 1, role: r.role, content: r.content, metadata: r.metadata ?? null, seq: i + 1, createdAt: new Date(0), eventKey: null })),
          }),
        };
      },
    }),
  };
  return { db, inserted };
}

describe('appendRaw — steps never land in the transcript table', () => {
  it('sends step rows to the step store and only the conversation to brain_chat_messages, answering in order', async () => {
    const { db, inserted } = fakeDb();
    const out = await appendRaw(db as never, 7, [
      { role: 'user', content: 'hi' },
      { role: 'tool', content: '', metadata: STEP },
      { role: 'assistant', content: 'done' },
    ]);
    expect(inserted.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(appendSteps).toHaveBeenCalledWith(db, 1, 7, [expect.objectContaining({ metadata: STEP, eventKey: null })]);
    expect(out.map((r) => r.role)).toEqual(['user', 'tool', 'assistant']);
    expect(isStepId(out[1]!.id)).toBe(true);
    // Anchored to the reply it precedes, so a client's seq sort keeps it in place.
    expect(out[1]!.seq).toBe(out[2]!.seq);
  });

  it('stamps both halves from one clock, rising with the batch index', async () => {
    const { db, inserted } = fakeDb();
    await appendRaw(db as never, 7, [
      { role: 'user', content: 'hi' },
      { role: 'tool', content: '', metadata: STEP },
      { role: 'assistant', content: 'done' },
    ]);
    const stepAt = appendSteps.mock.calls.at(-1)![3][0]!.createdAt!.getTime();
    const [userAt, replyAt] = inserted.map((r) => (r.createdAt as Date).getTime());
    expect(userAt! < stepAt && stepAt < replyAt!).toBe(true);
  });

  it('keeps a non-step tool message (a function result) in the transcript', async () => {
    const { db, inserted } = fakeDb();
    await appendRaw(db as never, 7, [{ role: 'tool', content: '{"ok":true}', metadata: '{"tool_call_id":"x"}' }]);
    expect(inserted).toHaveLength(1);
  });
});

describe('interleaveByTime', () => {
  const row = (id: number, at: number): BrainChatMessageRow => ({ id, role: 'user', content: '', metadata: null, seq: id, createdAt: new Date(at) });

  it('orders steps between the messages they happened between', () => {
    const merged = interleaveByTime([row(1, 0), row(2, 30)], [row(101, 10), row(102, 20)]);
    expect(merged.map((r) => r.id)).toEqual([1, 101, 102, 2]);
  });

  it('keeps a message before a step at the same instant', () => {
    expect(interleaveByTime([row(1, 5)], [row(101, 5)]).map((r) => r.id)).toEqual([1, 101]);
  });

  it('returns the messages untouched when there are no steps', () => {
    expect(interleaveByTime([row(1, 0)], []).map((r) => r.id)).toEqual([1]);
  });

  it('anchors each step to the seq of the message after it', () => {
    const merged = interleaveByTime([row(1, 0), row(2, 30)], [row(1_000_000_000_101, 10)]);
    expect(merged.map((r) => r.seq)).toEqual([1, 2, 2]);
  });
});

describe('anchorStepSeqs', () => {
  const msg = (id: number, seq: number): BrainChatMessageRow => ({ id, role: 'user', content: '', metadata: null, seq, createdAt: new Date(0) });
  const step = (id: number): BrainChatMessageRow => ({ id: 1_000_000_000_000 + id, role: 'tool', content: '', metadata: null, seq: 0, createdAt: new Date(0) });

  it('gives trailing steps the last message seq, or `before` when the batch has none', () => {
    expect(anchorStepSeqs([msg(1, 4), step(1)], 0).map((r) => r.seq)).toEqual([4, 4]);
    expect(anchorStepSeqs([step(1), step(2)], 9).map((r) => r.seq)).toEqual([9, 9]);
  });
});
