/**
 * PRD 35 WS4 parity rulings T2 (the fold) and T7 (what memory did to a call), through the real `startRun` on the Brain's loop and on
 * the agent engine. The loop's `buildWorkingTranscript` is the fold; the agent runs the SAME one as its compaction module
 * (`run/loopFold.ts`), so a long chat reads, summarises, records and reloads exactly as it does on the loop.
 */

import { describe, expect, it } from 'vitest';
import { consolidationMarkerOf } from '@seanhogg/builderforce-memory/working';
import { resetBrainRunStore, startRun, stopRun } from '../brainRunStore';
import { StreamInterruptedError, type ChatCompletionMessage, type StreamChatResult } from '../streamChatCompletion';
import { answer, bothEngines, stepsLabelled, type Observed, type StreamOpts } from '../test/engineKit';
import { getCell } from '../runStore/runCells';
import type { RunEngineId } from '../runStore/runTypes';

const BIG = 'x'.repeat(12_000);
/** A chat that has outgrown the history budget several times over (40 rows of ~3k tokens against 64k). */
const SEED: ChatCompletionMessage[] = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `${i}:${BIG}` }));
const SEED_IDS = SEED.map((_, i) => i + 1);

/** The compaction summarizer is the one call that asks for reasoning off. */
const isSummary = (opts: StreamOpts): boolean => opts.reasoning?.level === 'off';
const summary = (): StreamChatResult => ({ text: 'SUMMARY-TEXT', toolCalls: [], finishReason: 'stop', resolvedModel: 'summary-model', usage: { prompt: 9999, completion: 50 } });
const mainRequests = (o: Observed): StreamOpts[] => o.asked.filter((r) => !isSummary(r));
const markers = (o: Observed) => o.saved.filter((m) => consolidationMarkerOf({ metadata: m.metadata ?? null }));

const longChat = (reply: (opts: StreamOpts) => StreamChatResult | Promise<StreamChatResult>) => () => ({
  seed: SEED,
  seedIds: SEED_IDS,
  userTurn: 'carry on',
  stream: async (opts: StreamOpts) => (isSummary(opts) ? summary() : reply(opts)),
});

describe('T2 the fold is the Brain\'s own', () => {
  it('folds a long chat into one note without a visible model turn, and saves the durable marker', async () => {
    const { loop, agent } = await bothEngines(9300, longChat(answer('Done.')));
    expect(loop.asked.filter(isSummary).length).toBeGreaterThan(0);
    expect(agent.asked.filter(isSummary).length).toBe(loop.asked.filter(isSummary).length);
    // The model is shown the note, the active directive and the verbatim tail the loop shows it.
    expect(mainRequests(loop)).toHaveLength(1);
    expect(mainRequests(agent)).toHaveLength(1);
    // (The system prompt names the chat, whose key differs per run.)
    expect(mainRequests(agent)[0]!.messages.slice(1)).toEqual(mainRequests(loop)[0]!.messages.slice(1));
    expect(String(mainRequests(agent)[0]!.messages[1]!.content)).toContain('SUMMARY-TEXT');
    // The fold is announced once; the summary is not a turn (no `llm.complete`, no message, no usage).
    for (const o of [loop, agent]) {
      expect(stepsLabelled(o.trace, 'context.compacted')).toHaveLength(1);
      expect(stepsLabelled(o.trace, 'llm.complete')).toHaveLength(1);
      expect(JSON.stringify(stepsLabelled(o.trace, 'agent.message'))).not.toContain('SUMMARY-TEXT');
      expect(o.cell.runUsage.promptTokens).toBeLessThan(9999);
    }
    expect(agent.cell.runUsage).toEqual(loop.cell.runUsage);
    // The cell and the durable marker agree with the loop's: where the note ends, what it stands for.
    expect(agent.cell.compactMemo).toEqual(loop.cell.compactMemo);
    expect(markers(loop)).toHaveLength(1);
    expect(markers(agent)).toEqual(markers(loop));
  });

  it('a second run in the same chat reuses the note instead of summarising the history again', async () => {
    const summaries: Record<string, number[]> = {};
    for (const [engine, key] of [['loop', 9310], ['agent', 9311]] as Array<[RunEngineId, number]>) {
      resetBrainRunStore();
      let id = 0;
      const persistence = { sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m) => ({ id: (id += 1), seq: id, chatId, createdAt: '', metadata: null, ...m })) } as never;
      let calls = 0;
      const stream = async (opts: StreamOpts): Promise<StreamChatResult> => { if (isSummary(opts)) { calls += 1; return summary(); } return answer('Done.')(); };
      await startRun(key, { resolvedSystemPrompt: 'sys', persistence, stream, engine, seed: SEED, seedIds: SEED_IDS, userTurn: 'carry on' });
      const first = calls;
      await startRun(key, { resolvedSystemPrompt: 'sys', persistence, stream, engine, userTurn: 'and once more' });
      summaries[engine] = [first, calls - first];
      expect(getCell(key).compactMemo).not.toBeNull();
    }
    expect(summaries.loop![0]).toBeGreaterThan(0);
    expect(summaries.loop![1]).toBe(0);
    expect(summaries.agent).toEqual(summaries.loop);
  });

  it('a Stop that lands while the history is being folded ends the run before the model is asked', async () => {
    const { loop, agent } = await bothEngines(9320, (key) => ({
      seed: SEED,
      seedIds: SEED_IDS,
      userTurn: 'carry on',
      stream: async (opts: StreamOpts) => {
        if (!isSummary(opts)) return answer('Done.')();
        stopRun(key);
        return summary();
      },
    }));
    for (const o of [loop, agent]) {
      expect(mainRequests(o)).toHaveLength(0);
      expect(o.cell.error).toBe('');
      expect(o.saved.filter((m) => m.role === 'assistant' && !consolidationMarkerOf({ metadata: m.metadata ?? null }))).toEqual([]);
    }
  });
});

describe('T7 what memory did to a call rides that call only', () => {
  it('stamps the folded tokens on the first request of a turn, and not on its retry', async () => {
    const cut = () => { throw new StreamInterruptedError('stream cut', 'model-a'); };
    let main = 0;
    const { loop, agent } = await bothEngines(9330, () => { main = 0; return longChat(() => { main += 1; return main === 1 ? cut() : answer('Done.')(); })(); });
    const memory = (o: Observed) => mainRequests(o).map((r) => r.metadata?.memory);
    expect(memory(loop)[0]).toMatchObject({ trimmedTokens: expect.any(Number) });
    expect(memory(loop)[1]).toBeUndefined();
    expect(memory(agent)).toEqual(memory(loop));
  });
});
