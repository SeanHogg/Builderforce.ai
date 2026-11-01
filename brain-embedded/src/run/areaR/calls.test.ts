/**
 * Area R, the calls a turn makes (PRD 35 WS4 parity rulings): R6 (a call carries the TURN's step, not a per-call counter) and R8
 * (a call whose arguments never parsed is answered as the loop answers it). Each scenario runs through the real `startRun` on the
 * loop and on the agent; the agent is held to the loop.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_ROUTER_INVOKE } from '../../toolRouter';
import { bothEngines, calls, say, spec, stepsLabelled, type Capture, type Scenario } from './harness';

const TOOLS = [spec('read_file'), spec('edit_file')];
const LARGE = [spec('read_file'), ...Array.from({ length: 79 }, (_, i) => spec(`tool_${String(i + 1).padStart(3, '0')}`, `does the thing numbered ${i + 1}`))];

/** What the model read as the answers to its calls: the tool rows of the wire. */
const toolRows = (cap: Capture, call: number) => cap.wire[call]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);

describe('R6: a call carries the turn step', () => {
  it('the router step names the turn it was made in, after a turn that made two calls', async () => {
    const s: Scenario = {
      key: 9301,
      script: () => [
        calls({ name: 'read_file', args: { path: 'a.ts' } }, { name: 'read_file', args: { path: 'b.ts' } }),
        calls({ name: TOOL_ROUTER_INVOKE, args: { name: 'tool_070', args: {} } }),
        say('Done.'),
      ],
      request: () => ({ tools: LARGE }),
    };
    const { loop, agent } = await bothEngines(s);
    const routed = stepsLabelled(loop, 'tools.routed');
    expect(routed).toHaveLength(1);
    expect(routed[0]!.args).toMatchObject({ step: 1, via: TOOL_ROUTER_INVOKE });
    expect(stepsLabelled(agent, 'tools.routed')).toEqual(routed);
  });

  it('the tool steps follow the turns in the same order', async () => {
    const s: Scenario = {
      key: 9302,
      script: () => [calls({ name: 'read_file', args: { path: 'a.ts' } }), calls({ name: 'read_file', args: { path: 'a.ts' } }), say('Done.')],
      request: () => ({ tools: TOOLS }),
    };
    const { loop, agent } = await bothEngines(s);
    const labels = (cap: Capture) => cap.trace.map((e) => e.label).filter((l) => l === 'read_file' || l.startsWith('tools.'));
    expect(labels(agent)).toEqual(labels(loop));
    expect(toolRows(agent, 2)).toEqual(toolRows(loop, 2));
  });
});

describe('R8: a call whose arguments never parsed is declined as the loop declines it', () => {
  it('the tool never runs, the trace says why, and the model reads the same corrective', async () => {
    const s: Scenario = {
      key: 9303,
      script: () => [calls({ name: 'read_file', raw: '{"path": "a.ts' }), say('Done.')],
      request: () => ({ tools: TOOLS }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(loop.toolCalls).toEqual([]);
    expect(agent.toolCalls).toEqual([]);
    const declined = loop.trace.filter((e) => e.label === 'read_file (unparseable arguments)');
    expect(declined).toHaveLength(1);
    expect(agent.trace.filter((e) => e.label === 'read_file (unparseable arguments)')).toEqual(declined);
    expect(toolRows(agent, 1)).toEqual(toolRows(loop, 1));
  });

  it('a malformed ask_user with no prose gets the corrective the loop gives it', async () => {
    const s: Scenario = {
      key: 9304,
      script: () => [calls({ name: 'ask_user', raw: '{"question": ' }), say('Done.')],
      request: () => ({ tools: TOOLS }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(toolRows(loop, 1).join('\n')).toContain('ask_user needs');
    expect(toolRows(agent, 1)).toEqual(toolRows(loop, 1));
  });

  it('a declined call beside a good one leaves each row with its own post-step', async () => {
    const s: Scenario = {
      key: 9305,
      script: () => [calls({ name: 'read_file', raw: '{oops' }, { name: 'read_file', args: { path: 'a.ts' } }), calls({ name: 'read_file', args: { path: 'a.ts' } }), say('Done.')],
      request: () => ({ tools: TOOLS }),
      tools: { read_file: () => ({ ok: true, content: 'export const a = 1;' }) },
    };
    const { loop, agent } = await bothEngines(s);
    // The good read is cached against its own row, so its exact repeat is answered from the cache on both.
    expect(toolRows(agent, 2)).toEqual(toolRows(loop, 2));
    expect(agent.toolCalls).toEqual(loop.toolCalls);
    expect(agent.trace.map((e) => e.label)).toEqual(loop.trace.map((e) => e.label));
  });
});
