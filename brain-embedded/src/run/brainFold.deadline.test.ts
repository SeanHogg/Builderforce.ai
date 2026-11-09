/**
 * The fold's summary is bounded (`brainFold.ts` `foldLimits`). Chat #56654 (server #216): after a 323-step run grew the cell's
 * transcript, every new run - including the person's original request sent again after a Stop - sat in "starting up" for 5+
 * minutes before its first model call, because the chunked fold summary had no deadline, and a Stop left no memo so the next
 * run started the same fold over. A summary that never answers must not hold the first model call past the deadline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBrainRunStore, startRun, stopRun } from '../brainRunStore';
import type { ChatCompletionMessage, StreamChatResult } from '../streamChatCompletion';
import { getCell } from '../runStore/runCells';
import { foldLimits } from './brainFold';

const BIG = 'x'.repeat(12_000);
/** A chat that has outgrown the history budget several times over (40 rows of ~3k tokens against 64k). */
const SEED: ChatCompletionMessage[] = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `${i}:${BIG}` }));
const SEED_IDS = SEED.map((_, i) => i + 1);
const REQUEST = "REview the Visualizer's Map, Graph, Tower, and 3D.";

type Opts = { reasoning?: { level?: string }; signal?: AbortSignal };
/** The compaction summarizer is the one call that asks for reasoning off. */
const isSummary = (opts: Opts): boolean => opts.reasoning?.level === 'off';
const done = (): StreamChatResult => ({ text: 'Done.', toolCalls: [], finishReason: 'stop', resolvedModel: 'm', usage: { prompt: 10, completion: 2 } });

function persistence() {
  let id = 0;
  return { sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m) => ({ id: (id += 1), seq: id, chatId, createdAt: '', metadata: null, ...m })) } as never;
}

describe('the fold never holds a run\'s first model call past its deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBrainRunStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('regression: chat #56654 - run stopped, the same request sent again, its fold summary never answers: the model is asked at the deadline, not minutes later', async () => {
    const key = 56654;
    const summaries: AbortSignal[] = [];
    const main: Opts[] = [];
    const stream = (opts: Opts): Promise<StreamChatResult> => {
      if (!isSummary(opts)) {
        main.push(opts);
        return Promise.resolve(done());
      }
      // A summary that never answers (a local engine grinding through 48k-token chunks): it settles only when aborted.
      if (opts.signal) summaries.push(opts.signal);
      return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    };

    // The first run: stopped by the person while it is still folding.
    const first = startRun(key, { resolvedSystemPrompt: 'sys', persistence: persistence(), stream: stream as never, seed: SEED, seedIds: SEED_IDS, userTurn: REQUEST });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(summaries.length).toBeGreaterThan(0);
    stopRun(key);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(main).toHaveLength(0);
    expect(getCell(key).compactMemo).toBeNull(); // a stopped fold leaves no memo: the next run folds again

    // The identical request, sent again: a new run starts and folds again.
    const second = startRun(key, { resolvedSystemPrompt: 'sys', persistence: persistence(), stream: stream as never, userTurn: REQUEST });
    await vi.advanceTimersByTimeAsync(foldLimits.summaryMs - 1_000);
    expect(main).toHaveLength(0); // still inside the fold's allowance
    await vi.advanceTimersByTimeAsync(2_000);
    // Past the deadline: the summary is abandoned (and aborted), and the turn goes ahead on the drop-oldest window.
    expect(main).toHaveLength(1);
    expect(summaries.at(-1)!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await second;
    const trace = getCell(key).trace;
    expect(trace.filter((e) => e.label === 'context.fold_timeout')).toHaveLength(1);
    expect(trace.some((e) => e.label === 'llm.complete')).toBe(true);
    expect(getCell(key).running).toBe(false);
  });

  it('a summary that answers in time is used as before (no timeout step)', async () => {
    const key = 56655;
    const run = startRun(key, {
      resolvedSystemPrompt: 'sys',
      persistence: persistence(),
      stream: (async (opts: Opts) => (isSummary(opts) ? { ...done(), text: 'SUMMARY-TEXT' } : done())) as never,
      seed: SEED,
      seedIds: SEED_IDS,
      userTurn: 'carry on',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(getCell(key).compactMemo?.note).toContain('SUMMARY-TEXT');
    expect(getCell(key).trace.some((e) => e.label === 'context.fold_timeout')).toBe(false);
  });
});
