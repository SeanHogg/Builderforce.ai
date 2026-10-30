import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { resetRunSteering } from '../runSteering';
import { continuationLimits } from './deadline';
import { isLive, resetBrainRunStore } from './runControl';
import { getCell } from './runCells';
import { startRun } from './startRun';

// The ticket bookkeeping a settling run waits on - here it never answers.
vi.mock('./runBackstops', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runBackstops')>()),
  recordCodeChangeTicket: vi.fn(() => new Promise<void>(() => {})),
}));

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('a settling run\'s backstops hold the chat (the claim) - but not forever', () => {
  it('a hung ticket call is waited on for settleMs, said on the trace, and the chat is freed', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.settleMs = 40;
    try {
      const stream = async (): Promise<StreamChatResult> => {
        getCell(9340).codeChanged = true; // the run changed code: its ticket backstop will run
        return { text: 'Edited.', toolCalls: [], finishReason: 'stop', resolvedModel: 'm' };
      };
      let id = 0;
      const persistence = { sendMessages: async (chatId: number, rows: Array<{ role: string; content: string }>) => rows.map((row) => ({ id: (id += 1), chatId, createdAt: '', metadata: null, seq: id, ...row })) as never };

      const outcome = await Promise.race([
        startRun(9340, { resolvedSystemPrompt: 'sys', stream, persistence, userTurn: 'change it', projectId: 1, runTool: async () => '{}' }),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 2_000)),
      ]);

      expect(outcome).toBe('ran');
      expect(isLive(9340)).toBe(false);
      expect(getCell(9340).trace.some((e) => e.label === 'run.backstop_timeout')).toBe(true);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });
});
