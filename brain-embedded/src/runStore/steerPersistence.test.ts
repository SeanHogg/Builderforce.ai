import { describe, expect, it, vi } from 'vitest';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { makeCell } from './runCell';
import { persistSteer } from './steerPersistence';

/** The person's steered message is saved and shown as the run reads it (PRD 35 E10). */
describe('persistSteer', () => {
  it('saves a steer the run was asked to save, marked mid-turn, and splices it into the live view', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async (chatId: number, rows: Array<{ role: string; content: string; metadata?: string }>) =>
      rows.map((row, i) => ({ id: 70 + i, chatId, createdAt: '', ...row })) as never);

    await persistSteer(c, 5, { sendMessages }, { text: 'write the update now', fromPerson: true, persist: true });

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
    await persistSteer(c, 5, { sendMessages }, { text: 'shown by the host', fromPerson: true });
    expect(sendMessages).not.toHaveBeenCalled();
    expect(c.appended).toEqual([]);
  });

  it('says on the trace when the saved copy is lost — the steer itself already reached the run', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async () => { throw new Error('offline'); });
    await persistSteer(c, 5, { sendMessages }, { text: 'hello', persist: true });
    expect(c.trace.some((e) => e.label === 'steer.persist_failed' && (e.args as { error?: string } | undefined)?.error === 'offline')).toBe(true);
  });

  it('records the attachments a steer carried in the row metadata, as a normal turn does', async () => {
    const c = makeCell();
    const sendMessages = vi.fn(async (chatId: number, rows: Array<{ role: string; content: string; metadata?: string }>) =>
      rows.map((row, i) => ({ id: 90 + i, chatId, createdAt: '', ...row })) as never);
    const image = { key: 'a', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAA' };

    await persistSteer(c, 5, { sendMessages }, { text: 'what is this?', persist: true, attachments: [image] });

    const meta = JSON.parse(sendMessages.mock.calls[0]![1][0]!.metadata!) as { attachments?: unknown[] };
    expect(meta.attachments).toEqual([image]);
  });
});
