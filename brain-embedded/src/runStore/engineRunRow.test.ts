import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { resetRunSteering } from '../runSteering';
import { resetBrainRunStore } from './runControl';
import { startRun } from './startRun';
import type { RunEngineId } from './runTypes';
import type { BrainRunOutcome } from '../runOutcomeReport';

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

/** One scripted two-turn run: an edit, then the answer. A run that changed code is the one the ledger gets a row for (`codeRunOutcome`). */
async function twoTurnRun(engine: RunEngineId, key: number): Promise<{ outcomes: BrainRunOutcome[] }> {
  const outcomes: BrainRunOutcome[] = [];
  // Answers from what the model was SHOWN, not from a call count: the first model turn of a run (and the coder's re-ask of it)
  // edits; once a tool result is in the transcript it answers.
  const stream = async (opts: { tools?: unknown[]; messages: Array<{ role: string }> }): Promise<StreamChatResult> => {
    if (!opts.tools || opts.messages.some((m) => m.role === 'tool')) return { text: 'Done editing.', toolCalls: [], finishReason: 'stop', resolvedModel: 'm' };
    return { text: '', toolCalls: [{ id: 'c1', name: 'edit_file', args: JSON.stringify({ path: 'a.ts', old: 'a', new: 'b' }) }], finishReason: 'tool_calls', resolvedModel: 'm' };
  };
  let id = 0;
  const persistence = { sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m) => ({ id: (id += 1), chatId, createdAt: '', metadata: null, seq: id, ...m })) as never };
  await startRun(key, {
    resolvedSystemPrompt: 'sys',
    tools: [{ type: 'function', function: { name: 'edit_file', description: 'edit', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } } } } }],
    runTool: async () => ({ ok: true }),
    stream,
    persistence,
    userTurn: 'change a.ts',
    engine,
    reportOutcome: async (o) => { outcomes.push(o); },
  });
  return { outcomes };
}

describe('the run row the baseline reads (PRD 35 §8.1)', () => {
  it('reports exactly ONE row per run on each engine, with the same steps: every completed model turn, the finishing one included', async () => {
    const loop = await twoTurnRun('loop', 9801);
    const agent = await twoTurnRun('agent', 9802);
    expect(loop.outcomes).toHaveLength(1);
    expect(agent.outcomes).toHaveLength(1);
    expect(loop.outcomes[0]!.steps).toBe(2);
    expect(agent.outcomes[0]!.steps).toBe(loop.outcomes[0]!.steps);
  });
});
