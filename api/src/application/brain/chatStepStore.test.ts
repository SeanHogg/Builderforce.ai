import { describe, expect, it, vi } from 'vitest';

vi.mock('./chatCacheVersions', () => ({ bumpChatMessages: async () => undefined, bumpUnreadForChatAudience: async () => undefined }));
const { appendSteps } = vi.hoisted(() => ({
  appendSteps: vi.fn(async (_db: unknown, _tenantId: number, _chatId: number, steps: Array<{ metadata: string }>) =>
    steps.map((s, i) => ({ id: 1_000_000_000_000 + i, role: 'tool', content: '', metadata: s.metadata, seq: 0, createdAt: new Date(0) }))),
}));
vi.mock('./chatStepStore', async (importOriginal) => ({ ...(await importOriginal<object>()), appendSteps }));

import { brainChatMessages } from '../../infrastructure/database/schema';
import { appendRaw } from './brainMessageStore';
import { interleaveByTime, isStepId } from './chatStepStore';
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
    expect(appendSteps).toHaveBeenCalledWith(db, 1, 7, [{ metadata: STEP, eventKey: null }]);
    expect(out.map((r) => r.role)).toEqual(['user', 'tool', 'assistant']);
    expect(isStepId(out[1]!.id)).toBe(true);
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
});
