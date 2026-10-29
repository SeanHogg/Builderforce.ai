import { describe, expect, it, vi } from 'vitest';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { makeCell } from './runCell';
import { persistSteer } from './steerPersistence';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The person's steered message is saved and shown as the run reads it (PRD 35 E10). */
describe('persistSteer', () => {
  it('saves a steer the run was asked to save, marked mid-turn, and splices it into the live view', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async (chatId: number, rows: Array<{ role: string; content: string; metadata?: string }>) =>
      rows.map((row, i) => ({ id: 70 + i, chatId, createdAt: '', ...row })) as never);

    persistSteer(c, 5, { sendMessages }, { text: 'write the update now', fromPerson: true, persist: true });
    await settle();

    expect(sendMessages).toHaveBeenCalledTimes(1);
    const [chatId, rows] = sendMessages.mock.calls[0]!;
    expect(chatId).toBe(5);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'write the update now' });
    expect(isMidTurnMetadata(rows[0]!.metadata)).toBe(true);
    expect(c.appended.map((m) => m.content)).toEqual(['write the update now']);
  });

  it('does nothing for a steer a host already showed (persist unset)', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async () => [] as never);
    persistSteer(c, 5, { sendMessages }, { text: 'shown by the host', fromPerson: true });
    await settle();
    expect(sendMessages).not.toHaveBeenCalled();
    expect(c.appended).toEqual([]);
  });

  it('says on the trace when the saved copy is lost — the steer itself already reached the run', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async () => { throw new Error('offline'); });
    persistSteer(c, 5, { sendMessages }, { text: 'hello', persist: true });
    await settle();
    expect(c.trace.some((e) => e.label === 'steer.persist_failed' && String(e.result).includes('offline'))).toBe(true);
  });
});
