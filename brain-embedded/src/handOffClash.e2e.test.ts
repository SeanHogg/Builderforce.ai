/**
 * Regression (VS Code chat #70776), through the real run store: a `hand_off` whose tasks' paths
 * overlap is sent back ONCE naming the clash (nothing filed, still planning); the second overlapping
 * plan is carried out as is. ORDER BEATS PARALLELISM: only the leading disjoint tasks fan out, and
 * from the first overlapping task onward the coder runs them inline in plan order — so a
 * parent-directory task first keeps the whole plan inline, and one last still lets the tasks
 * before it run side by side. The trace and the diagnostics report say which ran how.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getRunTrace, resetBrainRunStore, startRun, type BrainStreamFn } from './brainRunStore';
import { modelTurnLog } from './modelScorecard';
import { formatRoutingByRole, routingByRole } from './routingByRole';

beforeEach(resetBrainRunStore);

const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });
const TOOLS = [spec('read_file'), spec('edit_file'), spec('builtin_tasks_create'), spec('spawn_agents')];

const SURFACE = { title: 'Restructure the surface', brief: 'Move files.', paths: ['pkg/src/surface'] };
const STYLE = { title: 'Restyle', brief: 'Restyle it.', paths: ['pkg/src/surface/style'] };
const FEATURES = { title: 'Feature panels', brief: 'Add panels.', paths: ['pkg/src/surface/features'] };
const SUMMARY = 'The surface is split into style, features and an overlay test.';

/** A planner that hands off `tasks` on its first two turns, then a coder that finishes. */
async function handOffTwice(runKey: number, tasks: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const results: string[] = [];
  let handOffs = 0;
  let nextTicket = 500;
  const stream: BrainStreamFn = async (opts) => {
    for (const m of opts.messages ?? []) if (m.role === 'tool' && typeof m.content === 'string') results.push(m.content);
    if (opts.role === 'plan' && handOffs < 2) {
      handOffs += 1;
      return { text: '', toolCalls: [{ id: `h${handOffs}`, name: 'hand_off', args: JSON.stringify({ summary: SUMMARY, tasks }) }], finishReason: 'tool_calls', resolvedModel: 'direct/m/planner' };
    }
    return { text: 'Done.', toolCalls: [], finishReason: 'stop', resolvedModel: 'direct/m/coder' };
  };
  await startRun(runKey, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    projectId: 11,
    runTool: async (name, args) => {
      calls.push({ name, args: (args ?? {}) as Record<string, unknown> });
      if (name === 'builtin_tasks_create') return { id: (nextTicket += 1) };
      if (name === 'spawn_agents') return { ok: true, workstreams: (args as { workstreams: unknown[] }).workstreams.map(() => ({ ok: true })) };
      return { ok: true };
    },
    stream,
    persistence: { sendMessages: async () => [] },
    userTurn: 'split the knowledge surface into style and features',
  });
  const trace = getRunTrace(runKey);
  return { calls, results, handOffs, trace, lines: formatRoutingByRole(routingByRole(modelTurnLog(trace), trace)) };
}

describe('an overlapping hand_off (chat #70776)', () => {
  it('parent-directory task FIRST: sent back once with the clash, then the whole plan runs inline in order', async () => {
    const { calls, results, handOffs, trace, lines } = await handOffTwice(7077, [SURFACE, STYLE, FEATURES]);

    // 1. The first plan was refused with the clash named; nothing was filed for it.
    expect(handOffs).toBe(2);
    // (The tool message is the result as JSON text, so the titles' quotes arrive escaped.)
    expect(results.some((r) => r.includes('hand_off not filed') && r.includes('Restructure the surface') && r.includes('Restyle') && r.includes('both own pkg/src/surface'))).toBe(true);
    expect(trace.filter((e) => e.label === 'hand_off.scope_clash')).toHaveLength(1);

    // 2. The second was carried out: one ticket per task, once; nothing fanned out — the
    //    children of task 1's directory may not start before it.
    expect(calls.filter((c) => c.name === 'builtin_tasks_create')).toHaveLength(3);
    expect(calls.some((c) => c.name === 'spawn_agents')).toBe(false);

    // 3. The record says how it ran, and the report shows it.
    expect(trace.find((e) => e.label === 'hand_off.mode')?.args).toMatchObject({
      mode: 'inline', parallelTasks: [], inlineTasks: ['Restructure the surface', 'Restyle', 'Feature panels'],
    });
    expect(lines.some((l) => l.includes('1 plan(s) sent back once for overlapping paths'))).toBe(true);
    expect(lines).toContain('  • hand_off: inline — 3 inline · overlap: "Restructure the surface" and "Restyle" both own pkg/src/surface');
  });

  it('overlapping task LAST: the disjoint tasks before it fan out, and it runs inline after them', async () => {
    const { calls, trace, lines } = await handOffTwice(7079, [STYLE, FEATURES, SURFACE]);
    expect(trace.filter((e) => e.label === 'hand_off.scope_clash')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'builtin_tasks_create')).toHaveLength(3);
    const fan = calls.filter((c) => c.name === 'spawn_agents');
    expect(fan).toHaveLength(1);
    expect((fan[0]!.args.workstreams as Array<{ label: string }>).map((w) => w.label)).toEqual(['#501 Restyle', '#502 Feature panels']);
    expect(trace.find((e) => e.label === 'hand_off.mode')?.args).toMatchObject({
      mode: 'mixed', parallelTasks: ['Restyle', 'Feature panels'], inlineTasks: ['Restructure the surface'],
    });
    expect(lines).toContain('  • hand_off: mixed — 2 side by side, 1 inline · overlap: "Restyle" and "Restructure the surface" both own pkg/src/surface/style');
  });
});
