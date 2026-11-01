/**
 * Area R, what a run does with direction that arrives while it works (PRD 35 WS4 parity rulings R2, R11, and the review rounds): a
 * steer or a child's report that arrives with the last prose turn is taken FIRST, before any judgement of the turn; the stall is
 * judged on the model's own words; the Brain's runner watches the steers itself; a Stop pressed during a hand-off waits for it.
 * Each scenario runs through the real `startRun` on the loop and on the agent; the agent is held to the loop.
 */

import { describe, expect, it } from 'vitest';
import { queueRunSteering } from '../../runSteering';
import { stopRun } from '../../runStore/runControl';
import { assistantRows, bothEngines, calls, say, spec, type Capture, type Scenario, type Turn } from './harness';

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
    const { loop, agent } = await bothEngines(s);
    expect(after(agent, 2)).toEqual(after(loop, 2));
    expect(after(loop, 2).slice(-1)[0]).toEqual({ role: 'user', content: REPORT });
    expect(loopSteps(agent)).toEqual(loopSteps(loop));
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
  });

  it('a stalled final turn gets no nudge row before the report', async () => {
    const s: Scenario = { key: 9502, script: () => [saysWith(STALL, REPORT), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(after(loop, 1).map((m) => m.content).join('\n')).not.toContain('zero tool calls');
    expect(after(agent, 1)).toEqual(after(loop, 1));
    expect(loopSteps(agent)).toEqual(loopSteps(loop));
  });

  it('a model whose stall budget is spent still has the report read, not stranded behind the notice', async () => {
    const s: Scenario = { key: 9503, script: () => [say(STALL), say(STALL), say(STALL), saysWith(STALL, REPORT), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(loop.error).toBe('');
    expect(agent.error).toBe(loop.error);
    expect(after(agent, 4)).toEqual(after(loop, 4));
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
  });

  it('several steers join into one row', async () => {
    const s: Scenario = { key: 9504, script: () => [saysWith('All done.', 'first thing', 'second thing'), say('Both done.')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(after(loop, 1).slice(-1)[0]).toEqual({ role: 'user', content: 'first thing\n\nsecond thing' });
    expect(after(agent, 1)).toEqual(after(loop, 1));
    expect(agent.transcript).toEqual(loop.transcript);
  });
});

describe('the stall is judged on the model own words', () => {
  it('a reasoning block that announces a call is read, as the loop reads it', async () => {
    const s: Scenario = {
      key: 9505,
      script: () => [say(`<think>${STALL}</think>Here you go.`), say('Found it in src/server.ts.')],
      request: () => ({ tools: TOOLS }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(agent.wire.length).toBe(loop.wire.length);
    expect(loopSteps(agent)).toEqual(loopSteps(loop));
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
  });
});

describe('the Brain runner watches the steers, once', () => {
  it('a wait a steer cuts short comes back encoded once, as a failed step', async () => {
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
    const { loop, agent } = await bothEngines(s);
    const rows = (cap: Capture) => cap.wire[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(agent.toolCalls).toEqual(loop.toolCalls);
    expect(rows(agent)).toEqual(rows(loop));
    expect(agent.trace.filter((e) => e.label === 'command_status')).toEqual(loop.trace.filter((e) => e.label === 'command_status'));
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
    const { loop, agent } = await bothEngines(s);
    expect(loop.toolCalls.filter((c) => c.name === 'builtin_tasks_create')).toHaveLength(2);
    expect(agent.toolCalls).toEqual(loop.toolCalls);
    expect(agent.trace.map((e) => e.label)).toEqual(loop.trace.map((e) => e.label));
  });
});
