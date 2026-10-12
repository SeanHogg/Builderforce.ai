import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchStepPersistence } from './stepOutbox';
import type { BrainMessage } from './types';

type Sent = { chatId: number; messages: Array<{ role: string; content: string; metadata?: string }> };

function fakeBase() {
  const sent: Sent[] = [];
  let id = 0;
  return {
    sent,
    base: {
      async sendMessages(chatId: number, messages: Sent['messages']): Promise<BrainMessage[]> {
        sent.push({ chatId, messages });
        return messages.map((m) => ({ id: ++id, role: m.role, content: m.content }) as unknown as BrainMessage);
      },
    },
  };
}

const step = (n: number) => ({ role: 'tool', content: '', metadata: JSON.stringify({ kind: 'step', n }) });

describe('batchStepPersistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('queues step rows and sends them as ONE request after the wait', async () => {
    const { base, sent } = fakeBase();
    const { persistence } = batchStepPersistence(base, { waitMs: 1000 });
    await persistence.sendMessages(7, [step(1)]);
    await persistence.sendMessages(7, [step(2)]);
    await persistence.sendMessages(7, [step(3)]);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.messages).toHaveLength(3);
  });

  it('sends immediately once the batch is full', async () => {
    const { base, sent } = fakeBase();
    const { persistence } = batchStepPersistence(base, { maxRows: 2, waitMs: 60_000 });
    await persistence.sendMessages(7, [step(1)]);
    await persistence.sendMessages(7, [step(2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.messages).toHaveLength(2);
  });

  it('piggybacks queued steps on the next conversational send and returns only the caller rows', async () => {
    const { base, sent } = fakeBase();
    const { persistence } = batchStepPersistence(base, { waitMs: 60_000 });
    await persistence.sendMessages(7, [step(1)]);
    await persistence.sendMessages(7, [step(2)]);
    const saved = await persistence.sendMessages(7, [{ role: 'assistant', content: 'done' }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.messages.map((m) => m.role)).toEqual(['tool', 'tool', 'assistant']);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.role).toBe('assistant');
    // Nothing left for the timer to send.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
  });

  it('keeps chats separate and flush() drains them all', async () => {
    const { base, sent } = fakeBase();
    const steps = batchStepPersistence(base, { waitMs: 60_000 });
    await steps.persistence.sendMessages(1, [step(1)]);
    await steps.persistence.sendMessages(2, [step(2)]);
    await steps.flush();
    expect(sent.map((s) => s.chatId).sort()).toEqual([1, 2]);
  });

  it('drops a failed step batch silently, as a single step write always was', async () => {
    const base = { sendMessages: vi.fn().mockRejectedValue(new Error('fetch failed')) };
    const steps = batchStepPersistence(base, { waitMs: 60_000 });
    await steps.persistence.sendMessages(1, [step(1)]);
    await expect(steps.flush()).resolves.toBeUndefined();
  });
});
