import { describe, expect, it, vi } from 'vitest';
import type { ToolSchema } from '@builderforce/agent-tools';
import { openCostLoopSession, type CostLoopSessionArgs } from './costLoopSession';
import { ROLE_CORE_TOOLS } from './deferredTools';
import { applyTaskStateUpdate, renderTaskState } from './taskState';
import { renderBudget } from './runBudget';
import { VOLATILE_TAIL_TAG } from '@seanhogg/builderforce-memory/handoff';

const alert = vi.hoisted(() => ({ notifyContainmentStop: vi.fn(async () => 'raised' as const) }));
vi.mock('../../alerts/containmentAlert', () => alert);

const tool = (name: string, description = name.replace(/_/g, ' ')): ToolSchema => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } },
});

const CORE = ['list_files', 'search_code', 'read_file', 'write_file', 'edit_file', 'delete_file', 'run_checks', 'ask_human', 'finish', 'web_fetch'];
const PLATFORM = ['builtin_tasks_create', 'builtin_tasks_list', 'builtin_key_results_update', 'builtin_incidents_open', 'builtin_kanban_signoff'];
const CATALOG = [...CORE, ...PLATFORM].map((n) => tool(n));
const ALL_ON = {
  COST_LEVER_A2_RUN_BUDGET: 'on', COST_LEVER_B1_STABLE_PREFIX: 'on', COST_LEVER_C1_DEFERRED_TOOLS: 'on',
  COST_LEVER_C2_OBSERVATION_MASKING: 'on', COST_LEVER_C3_TASK_STATE: 'on', COST_LEVER_D5_OUTPUT_CAPS: 'on',
};

function args(env: Record<string, string>, over: Partial<CostLoopSessionArgs> = {}): CostLoopSessionArgs {
  return {
    env: env as never, db: {} as never, tenantId: 7, executionId: 11, meterExecutionId: 11, plan: 'free', role: 'code',
    catalog: CATALOG,
    // A resumed tick with A2 totals, so no ledger/payload read is needed.
    resume: { tokenCap: 1_000, spentMillicents: 0, tokensUsed: 0 },
    promptTexts: ['Use `builtin_tasks_create` to file follow-ups.', 'Do the task.'],
    record: vi.fn(async () => undefined),
    ...over,
  };
}

const names = (tools: ToolSchema[]) => tools.map((t) => t.function.name);

describe('cost loop session — levers off', () => {
  const off = { COST_LEVERS_ALL: 'off' };

  it('advertises the whole catalog, prepends the affect block, keeps the caller max_tokens', async () => {
    const s = await openCostLoopSession(args(off, { resume: undefined }));
    expect(names(s.tools())).toEqual(names(CATALOG));
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }];
    expect(s.turnMessages(msgs, 'AFFECT')).toEqual([{ role: 'system', content: 'AFFECT' }, ...msgs]);
    expect(s.turnFields(undefined)).toEqual({});
    expect(s.turnFields(500)).toEqual({ max_tokens: 500 });
    // The env + tenant ride along so compaction can decide C9 (price-tier budget) itself.
    expect(s.compactOptions()).toEqual({ tools: CATALOG.map((t) => t), env: off, tenantId: 7 });
    expect(s.dispatch({ name: 'tool_search', args: { query: 'task' } })).toBeUndefined();
    expect(await s.beforeTurn(0, undefined, 0, 0)).toBeNull();
    expect(s.snapshot()).toEqual({});
  });
});

describe('cost loop session — levers on', () => {
  it('C1: advertises the role core set + prompt-named tools + meta tools, never the whole catalog', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    const advertised = names(s.tools());
    expect(advertised).toContain('read_file');
    expect(advertised).toContain('builtin_tasks_create'); // named in the prompt
    expect(advertised).not.toContain('builtin_incidents_open');
    expect(advertised.slice(-2)).toEqual(['tool_search', 'update_task_state']);
    expect(advertised.length).toBeLessThan(CATALOG.length + 2);
    expect(ROLE_CORE_TOOLS.code.length + 2).toBeLessThanOrEqual(20);
  });

  it('C1: tool_search loads matches for the rest of the run, and they persist in the snapshot', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    const r = s.dispatch({ name: 'tool_search', args: { query: 'open an incident' } });
    expect((r?.data as { matches: Array<{ name: string }> }).matches.map((m) => m.name)).toContain('builtin_incidents_open');
    expect(names(s.tools())).toContain('builtin_incidents_open');
    const next = await openCostLoopSession(args(ALL_ON, { resume: { ...s.snapshot() } }));
    expect(names(next.tools())).toContain('builtin_incidents_open');
  });

  it('C1: a deferred tool the model calls anyway is loaded (dispatch stays with the guard)', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    expect(s.dispatch({ name: 'builtin_key_results_update', args: {} })).toBeUndefined();
    expect(names(s.tools())).toContain('builtin_key_results_update');
  });

  it('C1: records the advertised set and its schema cost when it changes', async () => {
    const a = args(ALL_ON);
    const s = await openCostLoopSession(a);
    await s.beforeTurn(0, undefined, 0, 0);
    await s.beforeTurn(1, undefined, 0, 0);
    const toolEvents = (a.record as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === 'context.tools');
    expect(toolEvents).toHaveLength(1);
    expect((toolEvents[0]![2] as { toolsTokens: number }).toolsTokens).toBeGreaterThan(0);
  });

  it('C3: task state is stored, rendered in the trailing block, and persisted', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    expect(s.dispatch({ name: 'update_task_state', args: { goal: 'Ship the filter', nextStep: 'edit avatar.ts' } })?.data).toMatchObject({ ok: true });
    const out = s.turnMessages([{ role: 'user', content: 'U' }], 'AFFECT');
    const tail = out[out.length - 1]!;
    expect(tail.role).toBe('user');
    expect(String(tail.content)).toMatch(new RegExp(`^${VOLATILE_TAIL_TAG}`));
    expect(String(tail.content)).toContain('AFFECT');
    expect(String(tail.content)).toContain('Goal: Ship the filter');
    expect(s.snapshot().taskState).toEqual({ goal: 'Ship the filter', nextStep: 'edit avatar.ts' });
    expect(s.compactOptions()).toMatchObject({ maskObservationsAfterTurns: 6, pinTaskBrief: true });
  });

  it('C3: refuses a task state over ~600 tokens', () => {
    const r = applyTaskStateUpdate(undefined, { decisions: Array.from({ length: 200 }, (_, i) => `decision number ${i} about the design`) });
    expect(r.ok).toBe(false);
    expect(renderTaskState(undefined)).toBe('');
  });

  it('D5: caps max_tokens by role, keeping a lower caller value', async () => {
    const s = await openCostLoopSession(args(ALL_ON));
    expect(s.turnFields(undefined)).toEqual({ max_tokens: 8_192 });
    expect(s.turnFields(1_000)).toEqual({ max_tokens: 1_000 });
  });

  it('A2: counts tokens (BYO included), shows the budget line, converges at 80%, stops at 100% with progress', async () => {
    const a = args(ALL_ON);
    const s = await openCostLoopSession(a);
    expect(await s.beforeTurn(0, undefined, 0, 0)).toBeNull();
    expect(String(s.turnMessages([], undefined)[0]!.content)).toContain('~1000 tokens');
    await s.recordTurn({ usage: { promptTokens: 700, completionTokens: 150, totalTokens: 850 }, resolvedModel: 'm', byoFunded: true });
    expect(await s.beforeTurn(1, undefined, 0, 0)).toBeNull();
    expect(String(s.turnMessages([], undefined)[0]!.content)).toContain('converge');
    s.dispatch({ name: 'update_task_state', args: { nextStep: 'write the test' } });
    await s.recordTurn({ usage: { promptTokens: 200, completionTokens: 0, totalTokens: 200 }, resolvedModel: 'm', byoFunded: true });
    const stop = await s.beforeTurn(2, undefined, 0, 0);
    expect(stop).toMatch(/^Run contained: token limit reached \(1050\/1000 tokens\)\./);
    expect(stop).toContain('Next step: write the test');
    expect(s.snapshot()).toMatchObject({ tokensUsed: 1_050, spentMillicents: 0, tokenCap: 1_000 });
    // A5: the stop is pushed to the team, not only left on the timeline.
    expect(alert.notifyContainmentStop).toHaveBeenCalledWith(a.env, a.db, expect.objectContaining({
      tenantId: 7, executionId: 11, taskId: null, spendMillicents: 0, reason: expect.stringContaining('token limit reached'),
    }));
  });

  it('A2: the budget line names dollars only when a spend limit is declared', () => {
    expect(renderBudget({ maxFiles: null, maxRepositories: null, maxSpendMillicents: 400_000, maxTokens: 10 }, { files: 0, repositories: 0, spendMillicents: 100_000, tokens: 1 }))
      .toBe('Budget left: ~$3.00, ~9 tokens.');
    expect(renderBudget({ maxFiles: null, maxRepositories: null, maxSpendMillicents: null }, { files: 0, repositories: 0, spendMillicents: 0 })).toBe('');
  });
});
