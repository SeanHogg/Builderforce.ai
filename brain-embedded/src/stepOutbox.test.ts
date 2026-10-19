import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryOutboxStore, createOnlineSignal, createRevokeGate } from '@builderforce/write-outbox';
import { batchStepPersistence, installStepDurability, stepDurabilityFor, type StepOutgoingMessage } from './stepOutbox';
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

  it('keeps a failed step batch and retries it — never throws, never loses the rows', async () => {
    const base = { sendMessages: vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue([]) };
    const steps = batchStepPersistence(base, { waitMs: 60_000 });
    await steps.persistence.sendMessages(1, [step(1)]);
    await expect(steps.flush()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000); // first backoff
    expect(base.sendMessages).toHaveBeenCalledTimes(2);
    const [first, second] = base.sendMessages.mock.calls.map((c) => c[1] as Array<{ eventKey?: string }>);
    // The replay carries the SAME eventKey, so a write the server already took is not doubled.
    expect(first![0]!.eventKey).toMatch(/^step:/);
    expect(second![0]!.eventKey).toBe(first![0]!.eventKey);
  });

  it('hands piggybacked steps back to the lane when the conversational send fails', async () => {
    const { base, sent } = fakeBase();
    const failing = { sendMessages: vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(base.sendMessages) };
    const steps = batchStepPersistence(failing, { waitMs: 60_000 });
    await steps.persistence.sendMessages(7, [step(1)]);
    await expect(steps.persistence.sendMessages(7, [{ role: 'assistant', content: 'hi' }])).rejects.toThrow('offline');
    await steps.flush();
    expect(sent.map((s) => s.messages.map((m) => m.role))).toEqual([['tool']]);
  });

  it('with host durability, the next run in the chat replays what the last one left queued', async () => {
    installStepDurability({ storeFor: () => createMemoryOutboxStore() });
    try {
      const offline = { sendMessages: vi.fn().mockRejectedValue(new Error('fetch failed')) };
      const first = batchStepPersistence(offline, { ...stepDurabilityFor(7, 7), waitMs: 60_000 });
      await first.persistence.sendMessages(7, [step(1)]);
      await first.flush(); // fails — the row stays stored
      await vi.advanceTimersByTimeAsync(0); // let the store writes settle
      const { base, sent } = fakeBase();
      const second = batchStepPersistence(base, { ...stepDurabilityFor(7, 7), waitMs: 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      await second.flush();
      expect(sent.flatMap((s) => s.messages.map((m) => m.role))).toEqual(['tool']);
    } finally {
      installStepDurability(null);
    }
  });

  it('drains every stored queue on install — no run needed — including a sub-agent queue, to its chat', async () => {
    const chatStore = createMemoryOutboxStore<StepOutgoingMessage, number>();
    const childStore = createMemoryOutboxStore<StepOutgoingMessage, number>();
    await chatStore.put([{ id: 'e1', key: 7, item: step(1), seq: 1 }]);
    await childStore.put([{ id: 'e2', key: 7, item: step(2), seq: 2 }]);
    const sendRows = vi.fn().mockResolvedValue(undefined);
    installStepDurability({
      storeFor: (key) => (key === 'chat:7' ? chatStore : childStore),
      storedKeys: () => ['chat:7', 'chat:7:run:9'],
      sendRows,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const sent = sendRows.mock.calls.map((c) => [c[0], (c[1] as Array<{ eventKey?: string }>).map((r) => r.eventKey)]);
      expect(sent).toEqual(expect.arrayContaining([[7, ['step:e1']], [7, ['step:e2']]]));
      expect(sent).toHaveLength(2);
      expect(await chatStore.load()).toEqual([]);
    } finally {
      installStepDurability(null);
    }
  });

  it('drains again when the host comes back online', async () => {
    const store = createMemoryOutboxStore<StepOutgoingMessage, number>();
    const online = createOnlineSignal(false);
    const sendRows = vi.fn().mockResolvedValue(undefined);
    await store.put([{ id: 'e3', key: 3, item: step(3), seq: 3 }]); // written by a previous session
    installStepDurability({ storeFor: () => store, storedKeys: () => ['chat:3'], sendRows, online });
    try {
      await vi.advanceTimersByTimeAsync(0);
      online.set(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(sendRows).toHaveBeenCalledWith(3, [expect.objectContaining({ eventKey: 'step:e3' })], undefined);
    } finally {
      installStepDurability(null);
    }
  });

  it('does not drain a stored queue while send permission is revoked, and drains when it is restored', async () => {
    const store = createMemoryOutboxStore<StepOutgoingMessage, number>();
    const sendRows = vi.fn().mockResolvedValue(undefined);
    const permission = createRevokeGate('revoked');
    await store.put([{ id: 'e4', key: 4, item: step(4), seq: 4 }]);
    installStepDurability({
      storeFor: () => store,
      storedKeys: () => ['chat:4'],
      sendRows,
      sendPermission: permission,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(sendRows).not.toHaveBeenCalled();
      expect(await store.load()).toHaveLength(1);

      permission.grant();
      await vi.advanceTimersByTimeAsync(0);
      expect(sendRows).toHaveBeenCalledWith(4, [expect.objectContaining({ eventKey: 'step:e4' })], undefined);
    } finally {
      installStepDurability(null);
    }
  });
});

