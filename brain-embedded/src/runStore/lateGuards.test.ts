import { describe, expect, it, vi } from 'vitest';
import { budget, settledWithin } from './deadline';
import { makeCell } from './runCell';
import { stopBeforeStart } from './runControl';
import { keepStoppedTurn } from './turnPersistence';

/**
 * Work that outlives the wait for it (the settle's deadline, a continuation's allowance) may still LAND later - a
 * saved row is saved - but it must never be spliced into the view of a turn that has begun since.
 */
const later = <T,>(value: T, ms = 20) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const saves = () => ({
  sendMessages: vi.fn(async (chatId: number, rows: Array<{ role: string; content: string }>) =>
    later(rows.map((row, i) => ({ id: 100 + i, chatId, createdAt: '', metadata: null, seq: 100 + i, ...row })) as never)),
});

describe('keepStoppedTurn - a stopped partial that lands after the settle stopped waiting', () => {
  const stopped = () => ({ text: 'half an answer', source: {}, event: { ts: 't', category: 'message', label: 'agent.stopped', result: 'x' } }) as never;

  it('is saved, and spliced into the view only while its run is still current', async () => {
    const c = makeCell();
    c.stoppedTurn = stopped();
    const persistence = saves();

    await keepStoppedTurn(7, c, persistence as never, () => true);

    expect(persistence.sendMessages).toHaveBeenCalledTimes(1);
    expect(c.appended.map((m) => m.content)).toEqual(['half an answer']);
  });

  it('is NOT spliced into a newer run\'s view when it lands late (the row is still saved)', async () => {
    const c = makeCell();
    c.stoppedTurn = stopped();
    const persistence = saves();
    let current = true;

    const landing = keepStoppedTurn(7, c, persistence as never, () => current);
    current = false; // a newer run began while the save was in flight
    await landing;

    expect(persistence.sendMessages).toHaveBeenCalledTimes(1);
    expect(c.appended).toEqual([]);
  });
});

describe('stopBeforeStart - the "stopped before it started" answer', () => {
  it('is recorded in the live view while the caller still holds the chat', async () => {
    const persistence = saves();
    await stopBeforeStart(9501, 9501, persistence as never, () => true);
    expect(persistence.sendMessages).toHaveBeenCalledTimes(1);
  });

  it('written after the claim was released is saved but NOT recorded in the view', async () => {
    const persistence = saves();
    let held = true;

    const writing = stopBeforeStart(9502, 9502, persistence as never, () => held);
    held = false; // the claim was released while the write was in flight
    const row = await writing;

    expect(row).toBeDefined(); // saved
    const { getCell } = await import('./runCells');
    expect(getCell(9502).appended).toEqual([]);
  });
});

describe('budget - one allowance for a sequence of steps', () => {
  it('reports what is LEFT, shrinking as time passes, and never below 1 ms', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const left = budget(100);
      expect(left()).toBe(100);
      vi.setSystemTime(30);
      expect(left()).toBe(70);
      vi.setSystemTime(100);
      expect(left()).toBe(1);
      vi.setSystemTime(10_000);
      expect(left()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('settledWithin', () => {
  it('says whether a promise succeeded, failed or is still in flight - never rejecting', async () => {
    expect(await settledWithin(50, Promise.resolve('x'))).toBe('ok');
    expect(await settledWithin(50, Promise.reject(new Error('no')))).toBe('failed');
    expect(await settledWithin(10, new Promise(() => {}))).toBe('pending');
  });
});
