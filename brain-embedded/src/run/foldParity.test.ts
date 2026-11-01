/**
 * PRD 35 WS4 parity rulings T2 (the fold) and T7 (what memory did to a call), through the real `startRun` on the agent. The fold is
 * `buildWorkingTranscript`, run as the agent's compaction module (`run/brainFold.ts`), so a long chat reads, summarises, records and
 * reloads as the Brain's old loop did: the values pinned here are the ones that loop produced. The whole record of these scenarios is
 * also held by the snapshot suite (`run/parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { consolidationMarkerOf } from '@seanhogg/builderforce-memory/working';
import { resetBrainRunStore, startRun, stopRun } from '../brainRunStore';
import { StreamInterruptedError, type ChatCompletionMessage, type StreamChatResult } from '../streamChatCompletion';
import { answer, runOn, stepsLabelled, type Observed, type StreamOpts } from '../test/engineKit';
import { getCell } from '../runStore/runCells';

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
    const run = await runOn(9300, longChat(answer('Done.')));
    expect(run.asked.filter(isSummary).length).toBeGreaterThan(0);
    // The model is shown the note, the active directive and the verbatim tail (the snapshot `long-chat-folds` holds the exact request).
    expect(mainRequests(run)).toHaveLength(1);
    expect(String(mainRequests(run)[0]!.messages[1]!.content)).toContain('SUMMARY-TEXT');
    // The fold is announced once; the summary is not a turn (no `llm.complete`, no message, no usage).
    expect(stepsLabelled(run.trace, 'context.compacted')).toHaveLength(1);
    expect(stepsLabelled(run.trace, 'llm.complete')).toHaveLength(1);
    expect(JSON.stringify(stepsLabelled(run.trace, 'agent.message'))).not.toContain('SUMMARY-TEXT');
    expect(run.cell.runUsage.promptTokens).toBeLessThan(9999);
    // The cell and the durable marker: where the note ends, what it stands for.
    expect(run.cell.compactMemo!.note).toContain('SUMMARY-TEXT');
    expect(run.cell.compactMemo!.coveredEnd).toBeGreaterThan(0);
    expect(markers(run)).toHaveLength(1);
  });

  it('a second run in the same chat reuses the note instead of summarising the history again', async () => {
    const key = 9310;
    resetBrainRunStore();
    let id = 0;
    const persistence = { sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m) => ({ id: (id += 1), seq: id, chatId, createdAt: '', metadata: null, ...m })) } as never;
    let calls = 0;
    const stream = async (opts: StreamOpts): Promise<StreamChatResult> => { if (isSummary(opts)) { calls += 1; return summary(); } return answer('Done.')(); };
    await startRun(key, { resolvedSystemPrompt: 'sys', persistence, stream, seed: SEED, seedIds: SEED_IDS, userTurn: 'carry on' });
    const first = calls;
    await startRun(key, { resolvedSystemPrompt: 'sys', persistence, stream, userTurn: 'and once more' });
    const summaries = [first, calls - first];
    expect(getCell(key).compactMemo).not.toBeNull();
    expect(summaries[0]).toBeGreaterThan(0);
    expect(summaries[1]).toBe(0);
  });

  it('a Stop that lands while the history is being folded ends the run before the model is asked', async () => {
    const run = await runOn(9320, (key) => ({
      seed: SEED,
      seedIds: SEED_IDS,
      userTurn: 'carry on',
      stream: async (opts: StreamOpts) => {
        if (!isSummary(opts)) return answer('Done.')();
        stopRun(key);
        return summary();
      },
    }));
    expect(mainRequests(run)).toHaveLength(0);
    expect(run.cell.error).toBe('');
    expect(run.saved.filter((m) => m.role === 'assistant' && !consolidationMarkerOf({ metadata: m.metadata ?? null }))).toEqual([]);
  });
});

describe('T7 what memory did to a call rides that call only', () => {
  it('stamps the folded tokens on the first request of a turn, and not on its retry', async () => {
    const cut = () => { throw new StreamInterruptedError('stream cut', 'model-a'); };
    let main = 0;
    const run = await runOn(9330, () => { main = 0; return longChat(() => { main += 1; return main === 1 ? cut() : answer('Done.')(); })(); });
    const memory = (o: Observed) => mainRequests(o).map((r) => r.metadata?.memory);
    expect(memory(run)[0]).toMatchObject({ trimmedTokens: expect.any(Number) });
    expect(memory(run)[1]).toBeUndefined();
  });
});
