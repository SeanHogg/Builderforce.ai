/**
 * Area R, the menu the model is shown (PRD 35 WS4 parity rulings): R1 (chat mode keeps its tool menu), R7 (pins) and the menu
 * half of R9 (the router, the `tools.selected` step). Each scenario runs through the real `startRun` on the loop and on the
 * agent; the agent is held to the loop.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_ROUTER_INVOKE } from '../../toolRouter';
import { bothEngines, calls, say, spec, stepsLabelled, type Scenario } from './harness';

const SMALL = [spec('read_file'), spec('edit_file')];
/** More tools than one turn advertises (the limit is 64): the tail is reached through the router. */
const LARGE = [spec('read_file'), spec('edit_file'), ...Array.from({ length: 78 }, (_, i) => spec(`tool_${String(i + 1).padStart(3, '0')}`, `does the thing numbered ${i + 1}`))];

describe('R1: chat mode keeps its tool menu', () => {
  for (const mode of ['chat', 'work'] as const) {
    it(`${mode} mode offers the loop's menu`, async () => {
      const s: Scenario = { key: 9101, script: () => [say('Hello.')], request: () => ({ tools: SMALL, chatMode: mode }) };
      const { loop, agent } = await bothEngines(s);
      expect(loop.wire[0]!.tools).toContain('read_file');
      expect(agent.wire[0]!.tools).toEqual(loop.wire[0]!.tools);
    });
  }
});

describe('R7: pins follow what the run called', () => {
  const invoke = (name: string) => calls({ name: TOOL_ROUTER_INVOKE, args: { name, args: {} } });

  it('a tool reached through the router stays advertised on the next turn', async () => {
    const s: Scenario = { key: 9102, script: () => [invoke('tool_070'), say('Done.')], request: () => ({ tools: LARGE }) };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire[0]!.tools).not.toContain('tool_070');
    expect(loop.wire[1]!.tools).toContain('tool_070');
    expect(agent.wire[0]!.tools).toEqual(loop.wire[0]!.tools);
    expect(agent.wire[1]!.tools).toEqual(loop.wire[1]!.tools);
  });

  it('a tool an EARLIER run called pins nothing in the next one', async () => {
    const s: Scenario = {
      key: 9103,
      script: () => [invoke('tool_070'), say('Done.'), say('Again.')],
      request: () => ({ tools: LARGE }),
      follow: { userTurn: 'and once more' },
    };
    const { loop, agent } = await bothEngines(s);
    const second = (cap: typeof loop) => cap.wire[cap.firstRunCalls!]!.tools;
    expect(second(loop)).not.toContain('tool_070');
    expect(second(agent)).toEqual(second(loop));
  });
});

describe('the Brain ranks a large catalog its own way', () => {
  // Every tool matches the request a little, in a different way, so which 64 of the 80 are shown is decided by the RANKING alone.
  const WORDS = ['list', 'open', 'tickets', 'backlog'];
  const RANKED = Array.from({ length: 80 }, (_, i) => {
    const mask = (i % 15) + 1;
    const matched = WORDS.filter((_w, b) => (mask >> b) & 1);
    return spec(i % 7 === 0 ? `ticket_tool_${i}` : `tool_${i}`, `${matched.join(' ')} handler number ${i}`);
  });

  it('the agent shows the menu the loop shows, ranked by the Brain ranker', async () => {
    const s: Scenario = { key: 9106, script: () => [say('Hello.')], request: () => ({ tools: RANKED, userTurn: 'list my open tickets in the backlog' }) };
    const { loop, agent } = await bothEngines(s);
    const firstSixtyFour = RANKED.slice(0, 64).map((t) => t.function.name);
    // The request decides the menu: it is not the head of the catalog.
    expect(loop.wire[0]!.tools.filter((t) => t.startsWith('tool_') || t.startsWith('ticket_tool_'))).not.toEqual(firstSixtyFour);
    expect(agent.wire[0]!.tools).toEqual(loop.wire[0]!.tools);
  });
});

describe('a catalog of exactly 65 is trimmed by its size, `hand_off` included', () => {
  it('once planning closes the agent shows the menu the loop shows', async () => {
    // 63 host tools + `ask_user` + `hand_off` = 65. The request names `hand_off`, so it ranks in and one tool of the tail goes instead.
    const catalog = [spec('edit_file'), ...Array.from({ length: 62 }, (_, i) => spec(`tool_${i + 1}`))];
    const s: Scenario = {
      key: 9107,
      script: () => [calls({ name: 'edit_file', args: { path: 'a.ts', old: 'a', new: 'b' } }), say('Done.')],
      request: () => ({ tools: catalog, model: 'pin-1', modelStrict: true, userTurn: 'hand off the plan and tasks to the coder, then edit the file' }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire[1]!.tools).not.toContain('hand_off');
    expect(agent.wire[1]!.tools).toEqual(loop.wire[1]!.tools);
  });
});

describe('R9: the router and the selection step', () => {
  it('a trimmed turn carries the router and the `tools.selected` step, as the loop writes them', async () => {
    const s: Scenario = { key: 9104, script: () => [say('Hello.')], request: () => ({ tools: LARGE }) };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire[0]!.tools.some((t) => t === TOOL_ROUTER_INVOKE)).toBe(true);
    expect(agent.wire[0]!.tools).toEqual(loop.wire[0]!.tools);
    expect(stepsLabelled(loop, 'tools.selected')).toHaveLength(1);
    expect(stepsLabelled(agent, 'tools.selected')).toEqual(stepsLabelled(loop, 'tools.selected'));
  });

  it('a catalog the limit holds whole shows no router once `hand_off` closes', async () => {
    // 62 host tools + `ask_user` + `hand_off` = 64: never trimmed. A pinned model makes the first edit close planning.
    const catalog = [spec('edit_file'), ...Array.from({ length: 61 }, (_, i) => spec(`tool_${i + 1}`))];
    const s: Scenario = {
      key: 9105,
      script: () => [calls({ name: 'edit_file', args: { path: 'a.ts', old: 'a', new: 'b' } }), say('Done.')],
      request: () => ({ tools: catalog, model: 'pin-1', modelStrict: true }),
    };
    const { loop, agent } = await bothEngines(s);
    expect(loop.wire[0]!.tools).toContain('hand_off');
    expect(loop.wire[1]!.tools).not.toContain('hand_off');
    expect(loop.wire[1]!.tools.some((t) => t.startsWith('builtin_tools_'))).toBe(false);
    expect(agent.wire[1]!.tools).toEqual(loop.wire[1]!.tools);
    expect(stepsLabelled(loop, 'tools.selected')).toHaveLength(0);
    expect(stepsLabelled(agent, 'tools.selected')).toHaveLength(0);
  });
});
