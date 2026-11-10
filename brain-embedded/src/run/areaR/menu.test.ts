/**
 * Area R, the menu the model is shown (PRD 35 WS4 parity rulings): R1 (chat mode keeps its tool menu), R7 (pins) and the menu
 * half of R9 (the router, the `tools.selected` step). Each scenario runs the scripted run through the real `startRun` on the
 * agent, with values pinned as the old loop produced them (the whole record is also held by the snapshot suite,
 * `parity/snapshot.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { TOOL_ROUTER_INVOKE, routerToolSpecs } from '../../toolRouter';
import { calls, runOn, say, spec, stepsLabelled, type Capture, type Scenario } from './harness';

const SMALL = [spec('read_file'), spec('edit_file')];
/** More tools than one turn advertises (the limit is 64): the tail is reached through the router. */
const LARGE = [spec('read_file'), spec('edit_file'), ...Array.from({ length: 78 }, (_, i) => spec(`tool_${String(i + 1).padStart(3, '0')}`, `does the thing numbered ${i + 1}`))];

describe('R1: chat mode keeps its tool menu', () => {
  for (const mode of ['chat', 'work'] as const) {
    it(`${mode} mode offers the loop's menu`, async () => {
      const s: Scenario = { key: 9101, script: () => [say('Hello.')], request: () => ({ tools: SMALL, chatMode: mode }) };
      const run = await runOn(s);
      expect(run.wire[0]!.tools).toContain('read_file');
    });
  }
});

describe('R7: pins follow what the run called', () => {
  const invoke = (name: string) => calls({ name: TOOL_ROUTER_INVOKE, args: { name, args: {} } });

  it('a tool reached through the router stays advertised on the next turn', async () => {
    const s: Scenario = { key: 9102, script: () => [invoke('tool_070'), say('Done.')], request: () => ({ tools: LARGE }) };
    const run = await runOn(s);
    expect(run.wire[0]!.tools).not.toContain('tool_070');
    expect(run.wire[1]!.tools).toContain('tool_070');
  });

  it('a tool an EARLIER run called pins nothing in the next one', async () => {
    const s: Scenario = {
      key: 9103,
      script: () => [invoke('tool_070'), say('Done.'), say('Again.')],
      request: () => ({ tools: LARGE }),
      follow: { userTurn: 'and once more' },
    };
    const run = await runOn(s);
    const second = (cap: Capture) => cap.wire[cap.firstRunCalls!]!.tools;
    expect(second(run)).not.toContain('tool_070');
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
    const run = await runOn(s);
    const firstSixtyFour = RANKED.slice(0, 64).map((t) => t.function.name);
    // The request decides the menu: it is not the head of the catalog.
    expect(run.wire[0]!.tools.filter((t) => t.startsWith('tool_') || t.startsWith('ticket_tool_'))).not.toEqual(firstSixtyFour);
    // `tool_74` sits past the head of the catalog and matches all four words of the request in its description (mask 15), so it ranks in.
    expect(run.wire[0]!.tools).toContain('tool_74');
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
    const run = await runOn(s);
    // The menu is derived from the scenario's rules, not read off a run. The edit closes planning, so the second turn is a CODE turn,
    // capped by its role (`@builderforce/agent-run` `roleCap.ts`, limit 22, no catalog-order backfill): it keeps the role's tools the
    // catalog holds (`edit_file`, `ask_user`) and only tools that match the request - none of `tool_N` does. `hand_off` leaves the menu
    // once planning closes, and the router rides along because the cap trimmed the 65-tool catalog.
    const host = catalog.map((t) => t.function.name);
    const fixed = ['ask_user', 'hand_off'];
    const expected = ['edit_file', 'ask_user', ...routerToolSpecs(host.length + fixed.length).map((t) => t.function.name)];
    expect(run.wire[1]!.tools).toEqual(expected);
    expect(run.wire[1]!.tools).not.toContain(host[host.length - 1]);
    expect(run.wire[1]!.tools).not.toContain('hand_off');
  });
});

describe('R9: the router and the selection step', () => {
  it('a trimmed turn carries the router and the `tools.selected` step, as the loop writes them', async () => {
    const s: Scenario = { key: 9104, script: () => [say('Hello.')], request: () => ({ tools: LARGE }) };
    const run = await runOn(s);
    expect(run.wire[0]!.tools.some((t) => t === TOOL_ROUTER_INVOKE)).toBe(true);
    expect(stepsLabelled(run, 'tools.selected')).toHaveLength(1);
  });

  it('a catalog the limit holds whole shows no router once `hand_off` closes', async () => {
    // 20 host tools + `ask_user` + `hand_off` = 22: within the code turn's role limit (`roleCap.ts`, 22), so never trimmed, before or
    // after planning closes. A pinned model makes the first edit close planning.
    const catalog = [spec('edit_file'), ...Array.from({ length: 19 }, (_, i) => spec(`tool_${i + 1}`))];
    const s: Scenario = {
      key: 9105,
      script: () => [calls({ name: 'edit_file', args: { path: 'a.ts', old: 'a', new: 'b' } }), say('Done.')],
      request: () => ({ tools: catalog, model: 'pin-1', modelStrict: true }),
    };
    const run = await runOn(s);
    expect(run.wire[0]!.tools).toContain('hand_off');
    expect(run.wire[1]!.tools).not.toContain('hand_off');
    expect(run.wire[1]!.tools.some((t) => t.startsWith('builtin_tools_'))).toBe(false);
    expect(stepsLabelled(run, 'tools.selected')).toHaveLength(0);
  });
});
