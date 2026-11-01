/**
 * PRD 35 WS4 parity rulings, Area T (the turn): each row runs ONE scripted run through the real `startRun` on the Brain's loop and
 * on the agent engine, and holds the agent to what the loop did. The loop is the oracle; where a value is pinned as well it is
 * the one the loop produces.
 */

import { describe, expect, it } from 'vitest';
import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';
import { brainRequestError } from '../chatError';
import { TOOL_TURN_MIN_MAX_TOKENS } from '../effort';
import { StreamInterruptedError } from '../streamChatCompletion';
import { answer, bothEngines, callTool, script, stepsLabelled, toolSpec, type Observed } from '../test/engineKit';

const TOOLS = [toolSpec('read_file'), toolSpec('edit_file')];
const host = async () => ({ ok: true, content: 'export const a = 1;' });
const base = { tools: TOOLS, runTool: host, userTurn: 'look at a.ts' };
const read = (text = '') => callTool('read_file', { path: 'a.ts' }, text);

const stepsOf = (o: Observed): unknown[] => stepsLabelled(o.trace, 'llm.complete').map((e) => (e.args as { step?: unknown } | undefined)?.step);
const assistantRows = (o: Observed): string[] => o.saved.filter((m) => m.role === 'assistant').map((m) => m.content);

describe('T1 max_tokens is the Effort ceiling on the wire', () => {
  it('raises it to the tool-turn floor on every turn that can call tools', async () => {
    const { loop, agent } = await bothEngines(9100, () => ({ ...base, maxTokens: 2048, stream: script([read(), answer('Done.')]) }));
    expect(loop.asked.map((o) => o.maxTokens)).toEqual([TOOL_TURN_MIN_MAX_TOKENS, TOOL_TURN_MIN_MAX_TOKENS]);
    expect(agent.asked.map((o) => o.maxTokens)).toEqual(loop.asked.map((o) => o.maxTokens));
  });

  it('keeps the Effort ceiling on a turn with no tools', async () => {
    const { loop, agent } = await bothEngines(9102, () => ({ userTurn: 'hello', maxTokens: 2048, stream: script([answer('Hi.')]) }));
    expect(loop.asked.map((o) => o.maxTokens)).toEqual([2048]);
    expect(agent.asked.map((o) => o.maxTokens)).toEqual([2048]);
  });
});

describe('T3 the error that failed a run reaches the chat as it was thrown', () => {
  it('keeps the gateway verdict (status, unlock, requiredPlan, feature) and adds no prefix', async () => {
    const gate = () => brainRequestError(402, { error: 'Premium models need a validated card.', code: 'card_required', reason: 'no_card', unlock: 'validate_card', requiredPlan: 'pro', feature: 'premium_models' });
    const { loop, agent } = await bothEngines(9110, () => ({ ...base, stream: script([() => { throw gate(); }]) }));
    expect(loop.cell.error).toBe('Premium models need a validated card.');
    expect(agent.cell.error).toBe(loop.cell.error);
    expect(loop.cell.errorAction).not.toBeNull();
    expect(agent.cell.errorAction).toEqual(loop.cell.errorAction);
  });

  it('a transport failure with nothing left to try surfaces the model\'s own error, not "provider failed: ..."', async () => {
    const cut = (message: string, model: string) => () => { throw new StreamInterruptedError(message, model); };
    const { loop, agent } = await bothEngines(9112, () => ({ ...base, stream: script([cut('stream cut', 'model-a'), cut('stream cut again', 'model-b')]) }));
    expect(loop.cell.error).not.toBe('');
    expect(agent.cell.error).toBe(loop.cell.error);
    expect(agent.cell.error).not.toMatch(/provider failed/);
    expect(agent.cell.errorAction).toEqual(loop.cell.errorAction);
  });
});

describe('T4 a past turn is replayed without its reasoning tags', () => {
  it('shows the model its own turn as the reply, and writes the settled answer once', async () => {
    const { loop, agent } = await bothEngines(9120, () => ({ ...base, stream: script([read('<think>plan the read</think>Reading it now.'), answer('<think>weighing it</think>All done.')]) }));
    const replayed = (o: Observed) => o.asked[1]!.messages.find((m) => m.role === 'assistant')?.content;
    expect(replayed(loop)).toBe('Reading it now.');
    expect(replayed(agent)).toBe(replayed(loop));
    // The persisted reply keeps the reasoning block the person can open; the transcript holds the reply once.
    expect(assistantRows(agent).at(-1)).toBe(assistantRows(loop).at(-1));
    for (const o of [loop, agent]) {
      const roles = o.cell.transcript.map((m) => m.role);
      expect(roles.some((r, i) => r === 'assistant' && roles[i + 1] === 'assistant')).toBe(false);
    }
    expect(agent.cell.transcript.map((m) => m.role)).toEqual(loop.cell.transcript.map((m) => m.role));
  });

  it('hands the coder the planner\'s words without their tags', async () => {
    const stream = () => async (opts: { role?: string; messages: Array<{ role: string; content: unknown }> }) => {
      if (opts.role === 'plan') return callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' }, '<think>hidden plan</think>I will edit it.')();
      if (opts.messages.some((m) => m.role === 'tool')) return answer('Done.')();
      return callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' })();
    };
    const { loop, agent } = await bothEngines(9122, () => ({ ...base, userTurn: 'fix a.ts', stream: stream() }));
    const briefOf = (o: Observed) => String(o.asked.flatMap((r) => r.messages).find((m) => m.role === 'user' && String(m.content).startsWith('HAND-OFF'))?.content);
    expect(briefOf(loop)).toContain('I will edit it.');
    expect(briefOf(loop)).not.toContain('<think>');
    expect(briefOf(agent)).toBe(briefOf(loop));
  });
});

describe('T5 the focus files reach the model once, not in every request\'s tail', () => {
  it('sends the served file in the turn context and never again in the volatile tail', async () => {
    const body = 'FOCUS-SENTINEL docs/a.md body';
    const { loop, agent } = await bothEngines(9130, () => ({
      ...base,
      turnContext: async () => body,
      servedReads: async () => [{ path: 'docs/a.md', content: body, totalLines: 1 }],
      stream: script([read(), answer('Done.')]),
    }));
    const copies = (o: Observed) => JSON.stringify(o.asked[1]!.messages).split('FOCUS-SENTINEL').length - 1;
    expect(copies(loop)).toBe(1);
    expect(copies(agent)).toBe(1);
    const tail = agent.asked[1]!.messages.at(-1)!;
    if (isVolatileContent(tail.content)) expect(String(tail.content)).not.toContain('FOCUS-SENTINEL');
  });
});

describe('T6 the run\'s own record rides the volatile tail of a turn that can call tools', () => {
  it('restates what the run read before the next turn, in the tail the loop builds', async () => {
    // The record is worth restating once ten calls have left it (`WorkingMemory.brief`).
    const reads = Array.from({ length: 11 }, (_, i) => callTool('read_file', { path: `src/f${i}.ts` }, '', `r${i}`));
    const { loop, agent } = await bothEngines(9140, () => ({ ...base, stream: script([...reads, answer('Done.')]) }));
    const tailOf = (o: Observed) => o.asked[11]!.messages.at(-1)!;
    expect(isVolatileContent(tailOf(loop).content)).toBe(true);
    expect(String(tailOf(loop).content)).toContain('src/f0.ts');
    expect(tailOf(agent)).toEqual(tailOf(loop));
  });
});

describe('T10 the host\'s model preflight is asked once', () => {
  it('asks the host once and says it once on the trace', async () => {
    const calls: Record<number, number> = {};
    const { loop, agent } = await bothEngines(9150, (key) => ({
      ...base,
      modelPreflight: async () => { calls[key] = (calls[key] ?? 0) + 1; return { byoUnresolved: ['anthropic:expired'] }; },
      stream: script([answer('Done.')]),
    }));
    expect(calls[9150]).toBe(1);
    expect(calls[9151]).toBe(1);
    expect(stepsLabelled(loop.trace, 'model.preflight')).toHaveLength(1);
    expect(stepsLabelled(agent.trace, 'model.preflight')).toHaveLength(1);
  });
});

describe('T12 a QUICK run with a model that is not a strict pin codes on the quick model', () => {
  it('asks for the quick model from the first turn', async () => {
    const { loop, agent } = await bothEngines(9160, () => ({
      ...base,
      userTurn: 'Fix the typo in the README heading',
      model: 'soft-default',
      pipeline: { routing: 'auto', quickModel: 'quick-model' },
      stream: script([answer('Done.')]),
    }));
    expect(loop.asked[0]!.model).toBe('quick-model');
    expect(agent.asked[0]!.model).toBe('quick-model');
  });
});

describe('T14 the steps of a run are numbered as the loop numbers them', () => {
  it('numbers each turn once, a retry inside a turn included', async () => {
    const cut = () => { throw new StreamInterruptedError('stream cut', 'model-a'); };
    const { loop, agent } = await bothEngines(9170, () => ({ ...base, stream: script([read(), cut, read(), answer('Done.')]) }));
    expect(stepsOf(loop).length).toBe(3);
    expect(stepsOf(agent)).toEqual(stepsOf(loop));
  });
});
