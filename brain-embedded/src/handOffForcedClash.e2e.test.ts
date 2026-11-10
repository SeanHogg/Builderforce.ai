/**
 * A FORCED hand_off turn is never sent back for overlapping paths (`runStore/callPreflight.ts`).
 *
 * The analysis budget gives a planning run exactly one forced hand-off turn: `hand_off` alone,
 * the call required. Refusing an overlapping plan there would end planning with nothing filed
 * (`planBudgetTurn` spends the budget on the next turn), so the overlap correction that
 * `handOffClash.e2e.test.ts` drives on an ordinary turn must stand down: the overlapping plan is
 * carried out as is — every task filed, and (the parent-directory task being first) all inline in plan order.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PLAN_TURN_BUDGET } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun, type BrainStreamFn } from './brainRunStore';

beforeEach(resetBrainRunStore);

const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });
const TOOLS = [spec('read_file'), spec('edit_file'), spec('builtin_tasks_create'), spec('spawn_agents')];

/** The same overlapping plan the clash test sends: the first task's path is the parent of the other two. */
const PLAN = {
  summary: 'The surface is split into style, features and an overlay test.',
  tasks: [
    { title: 'Restructure the surface', brief: 'Move files.', paths: ['pkg/src/surface'] },
    { title: 'Restyle', brief: 'Restyle it.', paths: ['pkg/src/surface/style'] },
    { title: 'Feature panels', brief: 'Add panels.', paths: ['pkg/src/surface/features'] },
  ],
};

describe('an overlapping hand_off on the FORCED turn', () => {
  it('is carried out, not sent back — the analysis budget cannot dead-end on the overlap correction', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const results: string[] = [];
    const turns: Array<{ role: string; tools: string[]; toolChoice: unknown }> = [];
    let reads = 0;
    let handOffs = 0;
    let nextTicket = 500;
    // A planner that reads until the budget forces the hand-off, then hands off the overlapping plan.
    const stream: BrainStreamFn = async (opts) => {
      for (const m of opts.messages ?? []) if (m.role === 'tool' && typeof m.content === 'string') results.push(m.content);
      const tools = (opts.tools ?? []).map((t) => t.function.name);
      turns.push({ role: String(opts.role), tools, toolChoice: opts.tool_choice });
      if (tools.length === 1 && tools[0] === 'hand_off') {
        handOffs += 1;
        return { text: '', toolCalls: [{ id: `h${handOffs}`, name: 'hand_off', args: JSON.stringify(PLAN) }], finishReason: 'tool_calls', resolvedModel: 'direct/m/planner' };
      }
      if (opts.role === 'plan') {
        reads += 1;
        return { text: '', toolCalls: [{ id: `r${reads}`, name: 'read_file', args: JSON.stringify({ path: `src/file${reads}.ts` }) }], finishReason: 'tool_calls', resolvedModel: 'direct/m/planner' };
      }
      return { text: 'Done.', toolCalls: [], finishReason: 'stop', resolvedModel: 'direct/m/coder' };
    };
    await startRun(7078, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      projectId: 11,
      runTool: async (name, args) => {
        calls.push({ name, args: (args ?? {}) as Record<string, unknown> });
        if (name === 'read_file') return { ok: true, path: (args as { path?: string }).path, content: 'export const x = 1;' };
        if (name === 'builtin_tasks_create') return { id: (nextTicket += 1) };
        if (name === 'spawn_agents') return { ok: true, workstreams: (args as { workstreams: unknown[] }).workstreams.map(() => ({ ok: true })) };
        return { ok: true };
      },
      stream,
      persistence: { sendMessages: async () => [] },
      userTurn: 'split the knowledge surface into style and features',
    });
    const trace = getRunTrace(7078);

    // 1. The hand-off came on the forced turn: after the budget's reads, hand_off alone and required.
    const forcedAt = turns.findIndex((t) => t.tools.length === 1 && t.tools[0] === 'hand_off');
    expect(forcedAt).toBe(PLAN_TURN_BUDGET);
    expect(turns[forcedAt]!.toolChoice).toBe('required');
    expect(trace.some((e) => e.label === 'loop.hand_off_due')).toBe(true);

    // 2. The overlap correction stood down: no clash trace, no refusal, one hand-off only.
    expect(handOffs).toBe(1);
    expect(trace.some((e) => e.label === 'hand_off.scope_clash')).toBe(false);
    expect(results.some((r) => r.includes('hand_off not filed'))).toBe(false);
    // Planning did not dead-end: the budget was not spent with nothing filed.
    expect(trace.some((e) => e.label === 'loop.plan_budget_spent')).toBe(false);

    // 3. The overlapping plan was carried out as is: every task filed once. Order beats parallelism:
    //    the parent-directory task comes first, so its children may not start before it — all inline.
    expect(calls.filter((c) => c.name === 'builtin_tasks_create')).toHaveLength(3);
    expect(calls.some((c) => c.name === 'spawn_agents')).toBe(false);
    const mode = trace.find((e) => e.label === 'hand_off.mode');
    expect(mode?.args).toMatchObject({ mode: 'inline', parallelTasks: [], inlineTasks: ['Restructure the surface', 'Restyle', 'Feature panels'] });
  });
});
