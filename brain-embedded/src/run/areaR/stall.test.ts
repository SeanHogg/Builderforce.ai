/**
 * Area R, how a run ends (PRD 35 WS4 parity rulings): R2 (a turn sent back keeps its text), R3 (stall exhaustion and failover),
 * R4 (nudges are user rows, kept in the next run's seed), R5 (the stall is judged before the delivery rungs) and the stall half of
 * R9. Each scenario runs through the real `startRun` on the loop and on the agent; the agent is held to the loop.
 */

import { describe, expect, it } from 'vitest';
import { queueRunSteering } from '../../runSteering';
import { assistantRows, bothEngines, say, spec, stepsLabelled, type Capture, type Scenario } from './harness';

const TOOLS = [spec('read_file'), spec('edit_file')];
/** A turn that announces a call it never makes (a stall), and what the request is. */
const STALL = "I'll search the codebase for the handler.";
const NUDGE = 'Update the changelog.';
const onceStop = { onStop: async ({ round }: { round: number }) => (round === 0 ? NUDGE : null) };

/** The wire rows after the request: what the model read on the call that followed a send-back. */
const after = (cap: Capture, call: number) => cap.wire[call]!.messages;

describe('R2: a turn sent back keeps its text', () => {
  it('a stop hook that holds the run keeps what the model said as its own block, then the nudge as the next user row', async () => {
    const s: Scenario = { key: 9201, script: () => [say('All done, fixed it.'), say('Changelog updated.')], request: () => ({ tools: TOOLS, ...onceStop }) };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(loop)).toEqual([
      { role: 'assistant', content: 'All done, fixed it.', midTurn: true },
      { role: 'assistant', content: 'Changelog updated.', midTurn: false },
    ]);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(after(agent, 1)).toEqual(after(loop, 1));
  });

  it('a steer that arrives with the last turn keeps that turn as its own block, and the person\'s words are saved before it', async () => {
    const s: Scenario = {
      key: 9202,
      script: () => [
        ({ key }) => {
          queueRunSteering(key, 'also cover the edge case', { fromPerson: true, persist: true });
          return { text: 'All done.', toolCalls: [], finishReason: 'stop', resolvedModel: 'm1' };
        },
        say('Edge case covered too.'),
      ],
      request: () => ({ tools: TOOLS }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(loop.rows.map((r) => [r.role, r.content, r.midTurn])).toEqual([
      ['user', 'also cover the edge case', true],
      ['assistant', 'All done.', true],
      ['assistant', 'Edge case covered too.', false],
    ]);
    expect(agent.rows).toEqual(loop.rows);
    expect(after(agent, 1)).toEqual(after(loop, 1));
  });

  it('a narration nudge keeps the narrating turn as its own block', async () => {
    const s: Scenario = { key: 9203, script: () => [say(STALL), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(loop)[0]).toEqual({ role: 'assistant', content: STALL, midTurn: true });
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(after(agent, 1)).toEqual(after(loop, 1));
    expect(stepsLabelled(agent, 'loop.recover_announced_tool_call')).toEqual(stepsLabelled(loop, 'loop.recover_announced_tool_call'));
  });
});

describe('R3: a stalled model fails over, and one that has nothing left settles on what it said', () => {
  // Three re-prompts, then the budget is spent: the fourth stalled turn is the one that fails over or ends.
  const stalled = (model: string) => [say(STALL, model), say(STALL, model), say(STALL, model), say(STALL, model)];

  it('fails over onto the host\'s pick, skipping the model that stalled', async () => {
    const s: Scenario = {
      key: 9204,
      script: () => [...stalled('m1'), say('Found it in src/server.ts.', 'm2')],
      request: () => ({ tools: TOOLS, pickFallbackModel: (tried: readonly string[]) => (tried.includes('m2') ? undefined : 'm2') }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire[4]!.model).toBe('m2');
    expect(agent.wire[4]!.model).toBe('m2');
    expect(stepsLabelled(agent, 'loop.model_failover')).toEqual(stepsLabelled(loop, 'loop.model_failover'));
    expect(stepsLabelled(loop, 'loop.model_failover')).toHaveLength(1);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(after(agent, 4)).toEqual(after(loop, 4));
    expect(agent.error).toBe(loop.error);
  });

  it('with nobody to fail over onto, settles on the model\'s own text, with the reason as the chat\'s error', async () => {
    const s: Scenario = { key: 9205, script: () => stalled('m1'), request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(loop.threw).toBeUndefined();
    expect(agent.threw).toBeUndefined();
    expect(loop.error).not.toBe('');
    expect(agent.error).toBe(loop.error);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(assistantRows(loop).slice(-1)[0]).toEqual({ role: 'assistant', content: STALL, midTurn: false });
    expect(stepsLabelled(agent, 'loop.stall_unrecovered')).toEqual(stepsLabelled(loop, 'loop.stall_unrecovered'));
    expect(agent.activity).toBe(loop.activity);
  });
});

describe('a stalled turn with nothing to say is still a reply', () => {
  it('a model that answers nothing on a host with no tools saves the placeholder reply', async () => {
    const s: Scenario = { key: 9211, script: () => [say('')], request: () => ({ tools: undefined }) };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(loop)).toEqual([{ role: 'assistant', content: 'No response.', midTurn: false }]);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(agent.transcript).toEqual(loop.transcript);
  });

  it('a model that answers nothing until its budget is spent settles on the placeholder, with the reason', async () => {
    const s: Scenario = { key: 9212, script: () => [say(''), say(''), say(''), say('')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(agent.error).toBe(loop.error);
    expect(agent.transcript).toEqual(loop.transcript);
  });

  it('and one handed over to another model leaves the placeholder as the reply it was', async () => {
    const s: Scenario = {
      key: 9213,
      script: () => [say(''), say(''), say(''), say(''), say('Found it in src/server.ts.', 'm2')],
      request: () => ({ tools: TOOLS, pickFallbackModel: (tried: readonly string[]) => (tried.includes('m2') ? undefined : 'm2') }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
    expect(agent.transcript).toEqual(loop.transcript);
    expect(after(agent, 4)).toEqual(after(loop, 4));
  });
});

describe('R4: a correction is the person\'s row, and the next run starts from it', () => {
  it('the stop hook\'s nudge is a user row on the wire and in the chat\'s transcript', async () => {
    const s: Scenario = { key: 9206, script: () => [say('All done, fixed it.'), say('Changelog updated.')], request: () => ({ tools: TOOLS, ...onceStop }) };
    const { loop, agent } = await bothEngines(s);
    const nudge = { role: 'user', content: NUDGE };
    expect(after(loop, 1)).toContainEqual(nudge);
    expect(after(agent, 1)).toContainEqual(nudge);
    expect(loop.transcript).toContainEqual(nudge);
    expect(agent.transcript).toContainEqual(nudge);
    expect(agent.transcript).toEqual(loop.transcript);
  });
});

describe('R5: the stall is judged before the delivery rungs', () => {
  it('a narrating turn is re-prompted ahead of the stop hook, which holds the next turn', async () => {
    const s: Scenario = { key: 9207, script: () => [say(STALL), say('All done, fixed it.'), say('Changelog updated.')], request: () => ({ tools: TOOLS, ...onceStop }) };
    const { loop, agent } = await bothEngines(s);
    const order = (cap: Capture) => cap.trace.map((e) => e.label).filter((l) => l === 'loop.recover_announced_tool_call' || l === 'loop.stop_hook');
    expect(order(loop)).toEqual(['loop.recover_announced_tool_call', 'loop.stop_hook']);
    expect(order(agent)).toEqual(order(loop));
  });
});

describe('R9: the stall is judged against the menu the turn advertised', () => {
  it('the re-prompt step names how many tools the turn offered', async () => {
    const s: Scenario = { key: 9208, script: () => [say(STALL), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const { loop, agent } = await bothEngines(s);
    const [step] = stepsLabelled(loop, 'loop.recover_announced_tool_call');
    expect(step!.args).toMatchObject({ advertisedTools: expect.any(Number) });
    expect(stepsLabelled(agent, 'loop.recover_announced_tool_call')).toEqual(stepsLabelled(loop, 'loop.recover_announced_tool_call'));
  });

  it('a host that cannot run a tool treats a turn that calls one as the answer, saved once', async () => {
    const s: Scenario = {
      key: 9210,
      script: () => [() => ({ text: 'Let me look.', toolCalls: [{ id: 'c1', name: 'read_file', args: '{}' }], finishReason: 'tool_calls', resolvedModel: 'm1' })],
      request: () => ({ tools: TOOLS, runTool: undefined }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(assistantRows(loop)).toEqual([{ role: 'assistant', content: 'Let me look.', midTurn: false }]);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
  });

  it('a host that advertises tools but cannot run them judges no stall: the turn is the answer', async () => {
    const s: Scenario = { key: 9209, script: () => [say(STALL)], request: () => ({ tools: TOOLS, runTool: undefined }) };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire).toHaveLength(1);
    expect(agent.wire).toHaveLength(1);
    expect(assistantRows(agent)).toEqual(assistantRows(loop));
  });
});
