/**
 * Area R, how a run ends (PRD 35 WS4 parity rulings): R2 (a turn sent back keeps its text), R3 (stall exhaustion and failover),
 * R4 (nudges are user rows, kept in the next run's seed), R5 (the stall is judged before the delivery rungs) and the stall half of
 * R9. Each scenario runs the scripted run through the real `startRun` on the agent, with values pinned as the old loop produced
 * them (the whole record is also held by the snapshot suite, `parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { queueRunSteering } from '../../runSteering';
import { assistantRows, runOn, say, spec, stepsLabelled, type Capture, type Scenario } from './harness';

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
    const run = await runOn(s);
    expect(assistantRows(run)).toEqual([
      { role: 'assistant', content: 'All done, fixed it.', midTurn: true },
      { role: 'assistant', content: 'Changelog updated.', midTurn: false },
    ]);
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
    const run = await runOn(s);
    expect(run.rows.map((r) => [r.role, r.content, r.midTurn])).toEqual([
      ['user', 'also cover the edge case', true],
      ['assistant', 'All done.', true],
      ['assistant', 'Edge case covered too.', false],
    ]);
  });

  it('a narration nudge keeps the narrating turn as its own block', async () => {
    const s: Scenario = { key: 9203, script: () => [say(STALL), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(assistantRows(run)[0]).toEqual({ role: 'assistant', content: STALL, midTurn: true });
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
    const run = await runOn(s);
    expect(run.wire[4]!.model).toBe('m2');
    expect(stepsLabelled(run, 'loop.model_failover')).toHaveLength(1);
  });

  it('with nobody to fail over onto, settles on the model\'s own text, with the reason as the chat\'s error', async () => {
    const s: Scenario = { key: 9205, script: () => stalled('m1'), request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(run.threw).toBeUndefined();
    expect(run.error).not.toBe('');
    expect(assistantRows(run).slice(-1)[0]).toEqual({ role: 'assistant', content: STALL, midTurn: false });
  });
});

describe('a stalled turn with nothing to say is still a reply', () => {
  it('a model that answers nothing on a host with no tools saves the placeholder reply', async () => {
    const s: Scenario = { key: 9211, script: () => [say('')], request: () => ({ tools: undefined }) };
    const run = await runOn(s);
    expect(assistantRows(run)).toEqual([{ role: 'assistant', content: 'No response.', midTurn: false }]);
    expect(run.transcript).toEqual([
      { role: 'user', content: 'find the request handler' },
      { role: 'assistant', content: 'No response.' },
    ]);
  });

  it('a model that answers nothing until its budget is spent settles on the placeholder, with the reason', async () => {
    const s: Scenario = { key: 9212, script: () => [say(''), say(''), say(''), say('')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    expect(assistantRows(run).slice(-1)[0]).toEqual({ role: 'assistant', content: 'No response.', midTurn: false });
    expect(run.error).not.toBe('');
    expect(run.transcript.slice(-1)[0]).toEqual({ role: 'assistant', content: 'No response.' });
  });

  it('and one handed over to another model leaves the placeholder as the reply it was', async () => {
    const s: Scenario = {
      key: 9213,
      script: () => [say(''), say(''), say(''), say(''), say('Found it in src/server.ts.', 'm2')],
      request: () => ({ tools: TOOLS, pickFallbackModel: (tried: readonly string[]) => (tried.includes('m2') ? undefined : 'm2') }),
    };
    const run = await runOn(s);
    expect(run.wire[4]!.model).toBe('m2');
    expect(assistantRows(run)).toContainEqual({ role: 'assistant', content: 'No response.', midTurn: false });
    expect(assistantRows(run).slice(-1)[0]).toEqual({ role: 'assistant', content: 'Found it in src/server.ts.', midTurn: false });
    expect(run.transcript).toContainEqual({ role: 'assistant', content: 'No response.' });
  });
});

describe('R4: a correction is the person\'s row, and the next run starts from it', () => {
  it('the stop hook\'s nudge is a user row on the wire and in the chat\'s transcript', async () => {
    const s: Scenario = { key: 9206, script: () => [say('All done, fixed it.'), say('Changelog updated.')], request: () => ({ tools: TOOLS, ...onceStop }) };
    const run = await runOn(s);
    const nudge = { role: 'user', content: NUDGE };
    expect(after(run, 1)).toContainEqual(nudge);
    expect(run.transcript).toContainEqual(nudge);
  });
});

describe('R5: the stall is judged before the delivery rungs', () => {
  it('a narrating turn is re-prompted ahead of the stop hook, which holds the next turn', async () => {
    const s: Scenario = { key: 9207, script: () => [say(STALL), say('All done, fixed it.'), say('Changelog updated.')], request: () => ({ tools: TOOLS, ...onceStop }) };
    const run = await runOn(s);
    const order = (cap: Capture) => cap.trace.map((e) => e.label).filter((l) => l === 'loop.recover_announced_tool_call' || l === 'loop.stop_hook');
    expect(order(run)).toEqual(['loop.recover_announced_tool_call', 'loop.stop_hook']);
  });
});

describe('R9: the stall is judged against the menu the turn advertised', () => {
  it('the re-prompt step names how many tools the turn offered', async () => {
    const s: Scenario = { key: 9208, script: () => [say(STALL), say('Found it in src/server.ts.')], request: () => ({ tools: TOOLS }) };
    const run = await runOn(s);
    const [step] = stepsLabelled(run, 'loop.recover_announced_tool_call');
    expect(step!.args).toMatchObject({ advertisedTools: expect.any(Number) });
  });

  it('a host that cannot run a tool treats a turn that calls one as the answer, saved once', async () => {
    const s: Scenario = {
      key: 9210,
      script: () => [() => ({ text: 'Let me look.', toolCalls: [{ id: 'c1', name: 'read_file', args: '{}' }], finishReason: 'tool_calls', resolvedModel: 'm1' })],
      request: () => ({ tools: TOOLS, runTool: undefined }),
    };
    const run = await runOn(s);
    expect(assistantRows(run)).toEqual([{ role: 'assistant', content: 'Let me look.', midTurn: false }]);
  });

  it('a host that advertises tools but cannot run them judges no stall: the turn is the answer', async () => {
    const s: Scenario = { key: 9209, script: () => [say(STALL)], request: () => ({ tools: TOOLS, runTool: undefined }) };
    const run = await runOn(s);
    expect(run.wire).toHaveLength(1);
  });
});
