/**
 * Area R, what a run does with direction that arrives while it works (PRD 35 WS4 parity rulings R2, R11, and the review rounds): a
 * steer or a child's report that arrives with the last prose turn is taken FIRST, before any judgement of the turn; the stall is
 * judged on the model's own words; the Brain's runner watches the steers itself; a Stop pressed during a hand-off waits for it.
 * Each scenario runs the scripted run through the real `startRun` on the agent, with values pinned as the old loop produced them
 * (the whole record is also held by the snapshot suite, `parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { queueRunSteering } from '../../runSteering';
import { stopRun } from '../../runStore/runControl';
import { calls, runOn, say, spec, type Capture, type Scenario, type Turn } from './harness';

const TOOLS = [spec('read_file'), spec('edit_file'), spec('command_status')];
const STALL = "I'll search the codebase for the handler.";
const REPORT = 'Child report: the handler lives in src/server.ts.';

/** A prose turn that has a steer waiting by the time it ends. */
const saysWith = (text: string, ...steers: string[]): Turn => ({ key }) => {
  for (const s of steers) queueRunSteering(key, s);
  return { text, toolCalls: [], finishReason: 'stop', resolvedModel: 'm1' };
};
const after = (cap: Capture, call: number) => cap.wire[call]!.messages;
const loopSteps = (cap: Capture) => cap.trace.map((e) => e.label).filter((l) => l.startsWith('loop.') || l === 'steer.applied');

describe('a steer that arrives with the last prose turn is taken first', () => {
  it('a report keeps the ship gate: no stop hook is asked, nothing is spent, before the report is read', async () => {
    const s: Scenario = {
      key: 9501,
      script: () => [
        calls({ name: 'edit_file', args: { path: 'a.ts', old: 'a', new: 'b' } }),
        saysWith('All done, fixed it.', REPORT),
        say('Shipped it.'), say('Shipped it again.'), say('Shipped it once more.'), say('Done.'),
      ],
      request: () => ({ tools: TOOLS, model: 'pin-1', modelStrict: true, onStop: async () => null }),
    };
    const run = await runOn(s);
    expect(after(run, 2).slice(-1)[0]).toEqual({ role: 'user', content: REPORT });
  });

  it('a stalled final turn gets no nudge row before the report', async () => {
    const s: Scenario = { key: 9502, script: () => [saysWith(STALL, REPORT), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(after(run, 1).map((m) => m.content).join('\n')).not.toContain('zero tool calls');
  });

  it('a model whose stall budget is spent still has the report read, not stranded behind the notice', async () => {
    const s: Scenario = { key: 9503, script: () => [say(STALL), say(STALL), say(STALL), saysWith(STALL, REPORT), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(run.error).toBe('');
  });

  it('several steers join into one row', async () => {
    const s: Scenario = { key: 9504, script: () => [saysWith('All done.', 'first thing', 'second thing'), say('Both done.')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(after(run, 1).slice(-1)[0]).toEqual({ role: 'user', content: 'first thing\n\nsecond thing' });
  });
});

describe('the stall is judged on the model own words', () => {
  it('a reasoning block that announces a call is read, as the loop reads it', async () => {
    const s: Scenario = {
      key: 9505,
      script: () => [say(`<think>${STALL}</think>Here you go.`), say('Found it in src/server.ts.')],
      request: () => ({ tools: TOOLS }),
    };
    const run = await runOn(s);
    // The announcing reasoning is judged: the turn is re-prompted, so the model is called twice.
    expect(run.wire).toHaveLength(2);
    expect(loopSteps(run)).toContain('loop.recover_announced_tool_call');
  });
});

describe('the Brain runner watches the steers, once', () => {
  it('a wait a steer cuts short comes back encoded once, as a step that is not an error', async () => {
    const s: Scenario = {
      key: 9506,
      script: () => [calls({ name: 'command_status', args: { waitMs: 5000 } }), say('Read the new direction.')],
      request: () => ({ tools: TOOLS }),
      tools: (key) => ({
        command_status: async () => {
          queueRunSteering(key, 'only the API half', { interrupt: true, fromPerson: true, persist: true });
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, output: 'still running' };
        },
      }),
    };
    const run = await runOn(s);
    const rows = (cap: Capture) => cap.wire[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(run.toolCalls).toEqual([{ name: 'command_status', args: { waitMs: 5000 } }]);
    expect(rows(run)).toHaveLength(1);
    const status = run.trace.filter((e) => e.label === 'command_status');
    expect(status).toHaveLength(1);
    // The tool answered `ok` (it ignored the abort), so the step is not an error: the value the old loop recorded too (parity run).
    expect(status[0]!.isError).toBe(false);
  });
});

describe('a Stop pressed during a hand-off waits for it', () => {
  const PLAN = {
    summary: 'The title is rendered by the header.',
    tasks: [
      { title: 'Drop the header title', brief: 'Stop passing the project title.', paths: ['a/Header.tsx'] },
      { title: 'Let the surface omit its title', brief: 'Render no title span.', paths: ['b/Surface.tsx'] },
    ],
  };

  it('both tickets are filed and traced before the run settles', async () => {
    const s: Scenario = {
      key: 9507,
      script: () => [calls({ name: 'hand_off', args: PLAN })],
      request: () => ({ tools: [spec('read_file'), spec('builtin_tasks_create')], projectId: 11 }),
      tools: (key) => {
        let id = 900;
        return {
          builtin_tasks_create: async () => {
            if (id === 900) stopRun(key);
            await new Promise((r) => setTimeout(r, 15));
            id += 1;
            return { id };
          },
        };
      },
    };
    const run = await runOn(s);
    expect(run.toolCalls.filter((c) => c.name === 'builtin_tasks_create')).toHaveLength(2);
  });
});
