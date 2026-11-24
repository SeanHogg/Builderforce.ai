import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { drainRunSteering } from '../runSteering';
import { resetRunSteering } from '@builderforce/agent-run';
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

describe('backstops that outlive their deadline write nothing into the next run (MF1)', () => {
  it('a late from_delta call neither sets the next run\'s ticket state nor lands in its trace', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.settleMs = 30;
    try {
      let releaseTicket!: () => void;
      const ticket = new Promise<void>((resolve) => { releaseTicket = resolve; });
      let requestedTicket = false;
      await startRun(9360, {
        entryPoint: 'vscode',
        resolvedSystemPrompt: 'sys',
        persistence,
        userTurn: 'change it',
        projectId: 1,
        stream: async () => {
          const cell = getCell(9360);
          cell.codeChanged = true;
          cell.touchedFiles = ['a.ts'];
          return answer('Edited.');
        },
        runTool: async (name) => {
          expect(name).toBe('builtin_tickets_from_delta');
          requestedTicket = true;
          await ticket;
          return { taskId: 7 };
        },
      });
      expect(requestedTicket).toBe(true);
      expect(getCell(9360).trace.some((e) => e.label === 'run.backstop_timeout')).toBe(true);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const second = startRun(9360, {
    entryPoint: 'vscode',
        resolvedSystemPrompt: 'sys', persistence, userTurn: 'next',
        stream: async () => { await hold; return answer('Next.'); },
      });
      await until(() => isRunning(9360));

      releaseTicket();
      await delay(0); // Let the old close-out finish while its successor holds the chat.
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
      let modelStarted = false;
      let flushing = false;
      const first = startRun(9361, {
        entryPoint: 'vscode',
        resolvedSystemPrompt: 'sys',
        stream: async ({ signal }) => {
          modelStarted = true;
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
          return answer('');
        },
        persistence: {
          sendMessages: async (chatId, rows) => {
            if (!isRunning(9361) && rows.every((row) => row.role === 'tool')) {
              flushing = true;
              await new Promise<void>(() => {});
            }
            return persistence.sendMessages(chatId, rows);
          },
        },
        userTurn: 'first',
      });
      await until(() => modelStarted);
      stopRun(9361);
      await until(() => flushing && !isRunning(9361) && isLive(9361));

      stopRun(9361);
      expect(isLive(9361)).toBe(true); // the Stop did not free it
      const outcome = await startRun(9361, { entryPoint: 'vscode', resolvedSystemPrompt: 'sys', stream: async () => answer('no'), persistence, userTurn: 'second', userTurnMessageId: 5 });
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
  expect(check()).toBe(true);
}
