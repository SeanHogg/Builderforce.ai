import { describe, expect, it } from 'vitest';
import { createMemoryRecords } from '../store/records';
import type { SyncItem } from '../sync/chatSync';
import { runtimeSyncSink, type RovrRuntimeMessage } from '../sync/runtimeMessages';
import { createLocalFirstPersistence } from './localFirstPersistence';

describe('local-first persistence', () => {
  it('writes the turn to the device first, then hands it to the sync outbox', async () => {
    const records = createMemoryRecords();
    const chat = await records.createChat('t');
    const handed: Array<{ chatId: number; items: SyncItem[] }> = [];
    const persistence = createLocalFirstPersistence(records, { enqueue: (chatId, items) => handed.push({ chatId, items }) });

    const saved = await persistence.sendMessages(chat.id, [
      { role: 'user', content: 'hi' },
      // A step row as the step outbox hands it: the event key is the outbox's, not ours.
      { role: 'tool', content: '', metadata: '{"kind":"step"}', eventKey: 'step:abc' } as never,
    ]);

    expect(saved.map((m) => m.role)).toEqual(['user', 'tool']);
    expect((await records.listMessages(chat.id)).map((m) => m.content)).toEqual(['hi', '']);
    expect(handed).toEqual([
      {
        chatId: chat.id,
        items: [
          { kind: 'message', row: { role: 'user', content: 'hi' } },
          { kind: 'message', row: { role: 'tool', content: '', metadata: '{"kind":"step"}' } },
        ],
      },
    ]);
  });
});

describe('panel → worker hand-off', () => {
  it('retries until the worker acknowledges the write', async () => {
    const sent: RovrRuntimeMessage[] = [];
    let answer: unknown = undefined;
    const sink = runtimeSyncSink(
      async (message) => {
        sent.push(message);
        if (sent.length === 1) throw new Error('Receiving end does not exist');
        return answer;
      },
      async () => {
        answer = true;
      },
    );
    sink.enqueue(-1, [{ kind: 'message', row: { role: 'user', content: 'x' } }]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.length).toBe(2);
    expect(sent[0]).toEqual({ type: 'rovr.sync.enqueue', chatId: -1, items: [{ kind: 'message', row: { role: 'user', content: 'x' } }] });
  });
});
