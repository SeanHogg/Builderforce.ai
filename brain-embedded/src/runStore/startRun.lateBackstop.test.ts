import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { drainRunSteering, resetRunSteering } from '../runSteering';
import { continuationLimits } from './deadline';
import { isLive, isRunning, resetBrainRunStore, stopRun } from './runControl';
import { getCell } from './runCells';
import { startRun } from './startRun';

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'm' });
let rowId = 0;
const persistence = { sendMessages: async (chatId: number, rows: Array<{ role: string; content: string }>) => rows.map((row) => ({ id: (rowId += 1), chatId, createdAt: '', metadata: null, seq: rowId, ...row })) as never };

/** A run that changed code, whose ticket call (`runTool`) takes `ms` - or never returns. */
function codeRun(key: number, ticketCallMs: number | 'never') {
  const stream = async (): Promise<StreamChatResult> => { getCell(key).codeChanged = true; return answer('Edited.'); };
  const runTool = async (): Promise<unknown> => {
    if (ticketCallMs === 'never') return new Promise(() => {});
    await delay(ticketCallMs);
    return { id: 7 };
  };
  return startRun(key, { resolvedSystemPrompt: 'sys', stream, persistence, userTurn: 'change it', projectId: 1, runTool });
}

describe('backstops that outlive their deadline write nothing into the next run (MF1)', () => {
  it('a late from_delta call neither sets the next run\'s ticket state nor lands in its trace', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.settleMs = 30;
    try {
      await codeRun(9360, 150); // settles after ~30 ms; the ticket call is still in flight
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const second = startRun(9360, {
        resolvedSystemPrompt: 'sys', persistence, userTurn: 'next',
        stream: async () => { await hold; return answer('Next.'); },
      });
      await until(() => isRunning(9360));

      await delay(250); // the first run's late ticket call completes NOW, while the second run is running
      const c = getCell(9360);
      expect(c.deltaTicketId).toBeNull();
      expect(c.ticketRecorded).toBe(false);
      expect(c.deltaRecordedFiles).toEqual([]);
      expect(c.trace.some((e) => e.label === 'builtin_tickets_from_delta')).toBe(false);
      release();
      await second;
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });
});

describe('a Stop during the settle does not take the chat from the settling run (MF2)', () => {
  it('no second run starts until the unwinding run releases; the new request\'s words wait for it', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.settleMs = 200;
    try {
      const first = codeRun(9361, 'never');
      await until(() => !isRunning(9361) && isLive(9361)); // settling: the ticket call hangs

      stopRun(9361);
      expect(isLive(9361)).toBe(true); // the Stop did not free it
      const outcome = await startRun(9361, { resolvedSystemPrompt: 'sys', stream: async () => answer('no'), persistence, userTurn: 'second', userTurnMessageId: 5 });
      expect(outcome).toBe('joined');
      expect(isRunning(9361)).toBe(false);

      await first; // the bound (200 ms) ends the wait; the finally releases
      expect(isLive(9361)).toBe(false);
      expect(drainRunSteering(9361)).toMatchObject([{ text: 'second', fromPerson: true, saved: true }]);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });
});

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await delay(5);
}
