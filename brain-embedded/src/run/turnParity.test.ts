/**
 * PRD 35 WS4 parity rulings, Area T (the turn): each row runs ONE scripted run through the real `startRun` on the agent, with the
 * values pinned as the Brain's old loop produced them. The whole record of the run is also held by the snapshot suite
 * (`parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';
import { brainRequestError } from '../chatError';
import { TOOL_TURN_MIN_MAX_TOKENS } from '../effort';
import { StreamInterruptedError } from '../streamChatCompletion';
import { answer, callTool, runOn, script, stepsLabelled, toolSpec, type Observed } from '../test/engineKit';

const TOOLS = [toolSpec('read_file'), toolSpec('edit_file')];
const host = async () => ({ ok: true, content: 'export const a = 1;' });
const base = { tools: TOOLS, runTool: host, userTurn: 'look at a.ts' };
const read = (text = '') => callTool('read_file', { path: 'a.ts' }, text);

const stepsOf = (o: Observed): unknown[] => stepsLabelled(o.trace, 'llm.complete').map((e) => (e.args as { step?: unknown } | undefined)?.step);

describe('T1 max_tokens is the Effort ceiling on the wire', () => {
  it('raises it to the tool-turn floor on every turn that can call tools', async () => {
    const run = await runOn(9100, () => ({ ...base, maxTokens: 2048, stream: script([read(), answer('Done.')]) }));
    expect(run.asked.map((o) => o.maxTokens)).toEqual([TOOL_TURN_MIN_MAX_TOKENS, TOOL_TURN_MIN_MAX_TOKENS]);
  });

  it('keeps the Effort ceiling on a turn with no tools', async () => {
    const run = await runOn(9102, () => ({ userTurn: 'hello', maxTokens: 2048, stream: script([answer('Hi.')]) }));
    expect(run.asked.map((o) => o.maxTokens)).toEqual([2048]);
  });
});

describe('T3 the error that failed a run reaches the chat as it was thrown', () => {
  it('keeps the gateway verdict (status, unlock, requiredPlan, feature) and adds no prefix', async () => {
    const gate = () => brainRequestError(402, { error: 'Premium models need a validated card.', code: 'card_required', reason: 'no_card', unlock: 'validate_card', requiredPlan: 'pro', feature: 'premium_models' });
    const run = await runOn(9110, () => ({ ...base, stream: script([() => { throw gate(); }]) }));
    expect(run.cell.error).toBe('Premium models need a validated card.');
    expect(run.cell.errorAction).not.toBeNull();
  });

  it('a transport failure with nothing left to try surfaces the model\'s own error, not "provider failed: ..."', async () => {
    const cut = (message: string, model: string) => () => { throw new StreamInterruptedError(message, model); };
    const run = await runOn(9112, () => ({ ...base, stream: script([cut('stream cut', 'model-a'), cut('stream cut again', 'model-b')]) }));
    expect(run.cell.error).not.toBe('');
    expect(run.cell.error).toBe('stream cut again');
    expect(run.cell.error).not.toMatch(/provider failed/);
    expect(run.cell.errorAction).toBeNull();
  });
});

describe('T4 a past turn is replayed without its reasoning tags', () => {
  it('shows the model its own turn as the reply, and writes the settled answer once', async () => {
    const run = await runOn(9120, () => ({ ...base, stream: script([read('<think>plan the read</think>Reading it now.'), answer('<think>weighing it</think>All done.')]) }));
    const replayed = run.asked[1]!.messages.find((m) => m.role === 'assistant')?.content;
    expect(replayed).toBe('Reading it now.');
    // The transcript holds the reply once.
    const roles = run.cell.transcript.map((m) => m.role);
    expect(roles.some((r, i) => r === 'assistant' && roles[i + 1] === 'assistant')).toBe(false);
  });

  it('hands the coder the planner\'s words without their tags', async () => {
    const stream = () => async (opts: { role?: string; messages: Array<{ role: string; content: unknown }> }) => {
      if (opts.role === 'plan') return callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' }, '<think>hidden plan</think>I will edit it.')();
      if (opts.messages.some((m) => m.role === 'tool')) return answer('Done.')();
      return callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' })();
    };
    const run = await runOn(9122, () => ({ ...base, userTurn: 'fix a.ts', stream: stream() }));
    const brief = String(run.asked.flatMap((r) => r.messages).find((m) => m.role === 'user' && String(m.content).startsWith('HAND-OFF'))?.content);
    expect(brief).toContain('I will edit it.');
    expect(brief).not.toContain('<think>');
  });
});

describe('T5 the focus files reach the model once, not in every request\'s tail', () => {
  it('sends the served file in the turn context and never again in the volatile tail', async () => {
    const body = 'FOCUS-SENTINEL docs/a.md body';
    const run = await runOn(9130, () => ({
      ...base,
      turnContext: async () => body,
      servedReads: async () => [{ path: 'docs/a.md', content: body, totalLines: 1 }],
      stream: script([read(), answer('Done.')]),
    }));
    const copies = JSON.stringify(run.asked[1]!.messages).split('FOCUS-SENTINEL').length - 1;
    expect(copies).toBe(1);
    const tail = run.asked[1]!.messages.at(-1)!;
    if (isVolatileContent(tail.content)) expect(String(tail.content)).not.toContain('FOCUS-SENTINEL');
  });
});

describe('T6 the run\'s own record rides the volatile tail of a turn that can call tools', () => {
  it('restates what the run read before the next turn, in the tail of that turn', async () => {
    // The record is worth restating once ten calls have left it (`WorkingMemory.brief`).
    const reads = Array.from({ length: 11 }, (_, i) => callTool('read_file', { path: `src/f${i}.ts` }, '', `r${i}`));
    const run = await runOn(9140, () => ({ ...base, stream: script([...reads, answer('Done.')]) }));
    const tail = run.asked[11]!.messages.at(-1)!;
    expect(isVolatileContent(tail.content)).toBe(true);
    expect(String(tail.content)).toContain('src/f0.ts');
  });
});

describe('T10 the host\'s model preflight is asked once', () => {
  it('asks the host once and says it once on the trace', async () => {
    const calls: Record<number, number> = {};
    const run = await runOn(9150, (key) => ({
      ...base,
      modelPreflight: async () => { calls[key] = (calls[key] ?? 0) + 1; return { byoUnresolved: ['anthropic:expired'] }; },
      stream: script([answer('Done.')]),
    }));
    expect(calls[9150]).toBe(1);
    expect(stepsLabelled(run.trace, 'model.preflight')).toHaveLength(1);
  });
});

describe('T12 a QUICK run with a model that is not a strict pin codes on the quick model', () => {
  it('asks for the quick model from the first turn', async () => {
    const run = await runOn(9160, () => ({
      ...base,
      userTurn: 'Fix the typo in the README heading',
      model: 'soft-default',
      pipeline: { routing: 'auto', quickModel: 'quick-model' },
      stream: script([answer('Done.')]),
    }));
    expect(run.asked[0]!.model).toBe('quick-model');
  });
});

describe('T14 the steps of a run are numbered as the loop numbered them', () => {
  it('numbers each turn once, a retry inside a turn included', async () => {
    const cut = () => { throw new StreamInterruptedError('stream cut', 'model-a'); };
    const run = await runOn(9170, () => ({ ...base, stream: script([read(), cut, read(), answer('Done.')]) }));
    expect(stepsOf(run).length).toBe(3);
    expect(stepsOf(run)).toEqual([0, 1, 2]);
  });
});
