/**
 * PRD 35 WS4 parity rulings, Area T (the turn), continued: what a turn leaves on the run - the retract of a discarded re-ask, the
 * provider retry inside a turn, steering, and the spend cap's stop. Each row runs one scripted run through the real `startRun`
 * on the agent, with the values pinned as the Brain's old loop produced them (the whole record is also held by the snapshot
 * suite, `parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { PLAN_TURN_BUDGET } from '@builderforce/run-policy';
import { StreamInterruptedError } from '../streamChatCompletion';
import { queueRunSteering } from '../runSteering';
import { chatAsks } from '../runStore/chatAsks';
import { answer, callTool, runOn, script, stepsLabelled, toolSpec, type Observed, type StreamOpts } from '../test/engineKit';

const TOOLS = [toolSpec('read_file'), toolSpec('edit_file')];
const host = async () => ({ ok: true, content: 'export const a = 1;' });
const base = { tools: TOOLS, runTool: host, userTurn: 'look at a.ts' };
const read = (text = '') => callTool('read_file', { path: 'a.ts' }, text);
const edit = (text = '', over = {}) => callTool('edit_file', { path: 'a.ts', old: 'x', new: 'y' }, text, 'c-edit', over);
const cut = (model = 'model-a') => () => { throw new StreamInterruptedError('stream cut', model); };

const assistantRows = (o: Observed): string[] => o.saved.filter((m) => m.role === 'assistant').map((m) => m.content);
const messageSteps = (o: Observed): unknown[] => stepsLabelled(o.trace, 'agent.message').map((e) => e.result);

describe('T8 a turn the coder re-ask replaces leaves nothing behind', () => {
  /** The planner reaches for an edit (and says so); the coder re-asked in its place does the edit; then the run answers. */
  const reaskScenario = () => ({
    ...base,
    userTurn: 'fix a.ts',
    stream: async (opts: StreamOpts) => {
      if (opts.role === 'plan') return edit('planner words', { resolvedModel: 'planner-model', usage: { prompt: 5000, completion: 40 } })();
      if (opts.messages.some((m) => m.role === 'tool')) return answer('Done.')();
      return edit('coder words', { resolvedModel: 'coder-model', usage: { prompt: 7, completion: 3 } })();
    },
  });

  it('records the coder\'s turn only: its text, its steps, its usage and its model', async () => {
    const run = await runOn(9200, reaskScenario);
    expect(stepsLabelled(run.trace, 'llm.role_handoff')).toHaveLength(1);
    // The planner's turn is nowhere: not narrated, not an `llm.complete`, not in the usage the run reports, not the coder.
    expect(JSON.stringify(run.saved)).not.toContain('planner words');
    expect(messageSteps(run).join('\n')).not.toContain('planner words');
    expect(run.cell.runUsage.promptTokens).toBeLessThan(5000);
    expect(run.cell.codeModel).toBe('coder-model');
  });

  it('a re-ask that fails records its error step and nothing of the planner\'s turn', async () => {
    const failing = () => ({
      ...base,
      userTurn: 'fix a.ts',
      stream: async (opts: StreamOpts) => {
        if (opts.role === 'plan') return edit('planner words', { resolvedModel: 'planner-model' })();
        throw new Error('coder unavailable');
      },
    });
    const run = await runOn(9202, failing);
    expect(JSON.stringify(run.saved)).not.toContain('planner words');
    expect(run.cell.error).toBe('coder unavailable');
  });
});

describe('T9 a provider that broke is retried inside the turn', () => {
  it('re-asks the same menu and brief on the model the policy names, and spends no step', async () => {
    const run = await runOn(9210, () => ({ ...base, stream: script([read('Reading.'), cut(), read(), answer('Done.')]) }));
    // Requests: the first turn, the second turn's cut request, its retry, the answer.
    const failed = run.asked[1]!;
    const retry = run.asked[2]!;
    expect(retry.messages).toEqual(failed.messages);
    expect(retry.tools).toEqual(failed.tools);
    expect(retry.tool_choice).toEqual(failed.tool_choice);
  });

  it('a forced hand-off turn that is retried spends nothing forced: the same single-tool menu, once more', async () => {
    const planner = () => {
      let reads = 0;
      let edited = false;
      let cutOnce = true;
      let requests = 0;
      return async (opts: StreamOpts) => {
        requests += 1;
        if (requests > 60) throw new Error('the script ran away');
        const names = (opts.tools ?? []).map((t) => t.function.name);
        const forced = names.length === 1 && names[0] === 'hand_off';
        if (forced && cutOnce) { cutOnce = false; throw new StreamInterruptedError('stream cut', 'model-a'); }
        if (opts.role === 'plan' || forced) { reads += 1; return callTool('read_file', { path: `src/f${reads}.ts` }, '', `r${reads}`)(); }
        if (opts.tools && !edited) { edited = true; return edit('', { resolvedModel: 'm' })(); }
        return answer('Done.')();
      };
    };
    const run = await runOn(9212, () => ({ ...base, userTurn: 'remove the title from the top of the VSIX', stream: planner() }));
    const forced = run.asked.filter((r) => r.tools?.length === 1 && r.tools[0]!.function.name === 'hand_off');
    expect(forced.length).toBeGreaterThanOrEqual(2);
    const turnsBeforeForced = run.asked.findIndex((r) => r.tools?.length === 1 && r.tools[0]!.function.name === 'hand_off');
    expect(turnsBeforeForced).toBe(PLAN_TURN_BUDGET);
  });
});

describe('T11 steering', () => {
  const steered = (text: string) => (key: number) => ({
    ...base,
    stream: script([
      () => { queueRunSteering(key, text, { interrupt: true, fromPerson: true }); return read()(); },
      answer('Done.'),
    ]),
  });

  it('records steer.applied once per steer, and the person\'s steer is one of the chat\'s asks', async () => {
    const text = 'add a footer to the page';
    const run = await runOn(9220, steered(text));
    expect(stepsLabelled(run.trace, 'steer.applied')).toHaveLength(1);
    const heard = run.asked[1]!.messages.some((m) => m.role === 'user' && m.content === text);
    expect(heard).toBe(true);
    expect(chatAsks(run.cell.transcript)).toContain(text);
  });

  it('a steered "stop" is words to the model, not a command the run obeys', async () => {
    const run = await runOn(9222, steered('stop'));
    expect(run.asked).toHaveLength(2);
    expect(run.asked[1]!.messages.some((m) => m.role === 'user' && m.content === 'stop')).toBe(true);
    expect(run.cell.error).toBe('');
    expect(assistantRows(run).at(-1)).toBe('Done.');
  });
});

describe('T13 the spend cap\'s stop is not a settled answer', () => {
  it('saves the stop plainly - no provenance chip - and tells the chat once', async () => {
    const activity: Record<number, number> = {};
    const pricey = callTool('read_file', { path: 'a.ts' }, '', 'c1', { resolvedModel: 'anthropic/claude-opus-4.5', usage: { prompt: 1_000_000, completion: 0 } });
    const run = await runOn(9230, (key) => ({
      ...base,
      maxRunBudgetUsd: 1,
      onActivity: () => { activity[key] = (activity[key] ?? 0) + 1; },
      stream: script([pricey]),
    }));
    expect(run.asked).toHaveLength(1);
    const stop = run.saved.filter((m) => m.role === 'assistant');
    expect(stop).toHaveLength(1);
    expect(stop[0]!.content).toContain('Run stopped');
    expect(stop[0]!.metadata ?? null).toBeNull();
    expect(activity[9230]).toBe(1);
  });
});
