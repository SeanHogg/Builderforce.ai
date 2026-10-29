import { beforeEach, describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from './brainTriage';
import { codeRunOutcome } from './runOutcomeReport';
import { resetBrainRunStore } from './runStore/runControl';
import { getCell } from './runStore/runCells';
import { startRun } from './runStore/startRun';

const turn = (args: Record<string, unknown>): BrainTraceEvent => ({ ts: 't', category: 'llm', label: 'llm.complete', args, result: 'ok' }) as BrainTraceEvent;
const outcomeOf = (trace: BrainTraceEvent[]) => codeRunOutcome({
  runId: 'ide:1:1', codeModel: 'local/ollama/qwen', codeChanged: true, aborted: false, failed: false, shipped: false, trace,
});

describe('a run served entirely on this machine reports it was free', () => {
  it('costMc: 0 when EVERY completed turn was served locally', () => {
    expect(outcomeOf([turn({ costMc: 0 }), turn({ costMc: 0 })])).toMatchObject({ steps: 2, costMc: 0 });
  });

  it('cost ABSENT (unknown, never 0) when any turn was not - a gateway or BYO run is not mistaken for a free one', () => {
    const mixed = outcomeOf([turn({ costMc: 0 }), turn({ model: 'gpt-5' })]);
    expect(mixed).not.toBeNull();
    expect('costMc' in mixed!).toBe(false);
    expect('costMc' in outcomeOf([turn({ model: 'gpt-5' })])!).toBe(false);
  });

  it('cost ABSENT when no turn completed (nothing to say the run was free)', () => {
    expect('costMc' in outcomeOf([])!).toBe(false);
  });
});

describe('the run\'s model trace carries the marker', () => {
  beforeEach(() => resetBrainRunStore());

  const run = async (key: number, result: Record<string, unknown>) => {
    let id = 0;
    await startRun(key, {
      resolvedSystemPrompt: 'sys',
      userTurn: 'hi',
      stream: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop', ...result }) as never,
      persistence: { sendMessages: async (chatId, rows) => rows.map((row) => ({ id: (id += 1), chatId, createdAt: '', metadata: null, seq: id, ...row })) as never },
    });
    return getCell(key).trace.find((e) => e.label === 'llm.complete');
  };

  it('marks a turn the local-first runner served on this machine', async () => {
    const ev = await run(9350, { resolvedModel: 'local/ollama/llama3', localFirst: [{ target: 'local/ollama/llama3', outcome: 'served' }] });
    expect(ev?.args?.costMc).toBe(0);
  });

  it('leaves a hosted local-grammar turn (kimi-code) without a cost', async () => {
    const ev = await run(9352, { resolvedModel: 'local/kimi-code/k3' });
    expect(ev?.args && 'costMc' in ev.args).toBe(false);
  });

  it('leaves a gateway turn unmarked', async () => {
    const ev = await run(9351, { resolvedModel: 'gpt-5' });
    expect(ev?.args && 'costMc' in ev.args).toBe(false);
  });
});
