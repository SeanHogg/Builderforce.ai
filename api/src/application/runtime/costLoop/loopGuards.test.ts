import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { LoopHooks, LoopPorts, ParsedToolCall, TurnContext } from '@builderforce/agent-loop';

const h = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  skip: vi.fn(async () => false),
  outcome: vi.fn(async () => undefined),
}));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../../llm/difficultyGate', () => ({ shouldSkipWeakAttempt: h.skip, recordCascadeOutcome: h.outcome, weakPassRate: vi.fn(async () => undefined) }));

import { LoopGuards, type LoopGuardDeps } from './loopGuards';
import type { CloudRunModelState } from '../cloudAgent/cloudRunModelPolicy';

type Row = Record<string, unknown>;
const ON = { COST_LEVER_A3_PROGRESS_DETECTOR: 'on', COST_LEVER_D7_DETERMINISTIC_HANDLERS: 'on', COST_LEVER_D1_VERIFIER_CASCADE: 'on', COST_LEVER_D8_PARALLEL_TOOL_CALLS: 'on' };
const OFF = { COST_LEVERS_ALL: 'off' };
const RANK: Record<string, number> = { weak: 0, mid: 1, strong: 2 };
const ladder = { candidates: ['strong', 'weak', 'mid'], rankOf: (m: string) => RANK[m] ?? 1 };

const call = (id: string, name: string, args: Record<string, unknown>): ParsedToolCall => ({ id, name, args, raw: { id, name, arguments: JSON.stringify(args) }, malformed: false });
const ctx = (step = 0) => ({ step, stepInCall: 0, messages: [], signal: undefined, output: '', failureStreak: 0 }) as TurnContext<Row>;

function harness(env: Record<string, string>, model = 'weak') {
  let state: CloudRunModelState = { policy: initialRunPolicy({ pinnedModel: model, startPhase: 'code', pinReleasable: true, lockAfterFirstSuccess: true }), stallRecoveries: 0 };
  const deps: LoopGuardDeps = {
    db: {} as never,
    evt: { tenantId: 3, executionId: 77 },
    role: 'code',
    ladder,
    repoCtx: { branch: 'bf/t', base: 'main' } as never,
    model: { get: () => state, set: (next) => { state = next; } },
    resolvedModel: () => state.policy.model,
    features: (turnIndex) => ({ actionType: 'bugfix', role: 'code', promptTokens: 1000, toolCount: 20, turnIndex }),
    pause: vi.fn(async () => ({ approvalId: 'appr-1' })),
  };
  const guards = new LoopGuards(env, 3);
  const ports: LoopPorts<Row> = {
    complete: vi.fn(),
    dispatch: vi.fn(async (c: ParsedToolCall) => ({ data: { ok: true, echoed: c.name } })),
  };
  const hooks: LoopHooks<Row> = {};
  const wrapped = guards.wrap(hooks, ports, deps);
  return { guards, deps, wrapped, model: () => state };
}

beforeEach(() => {
  h.record.mockClear();
  h.outcome.mockClear();
  h.skip.mockResolvedValue(false);
});

describe('LoopGuards — levers off', () => {
  it('passes every hook and port through and persists nothing', async () => {
    const { guards, wrapped } = harness(OFF);
    expect(wrapped.ports.isReadOnly).toBeUndefined();
    const r = await wrapped.ports.dispatch(call('a', 'write_file', { path: 'x.json', content: '{' }), ctx());
    expect(r.data).toEqual({ ok: true, echoed: 'write_file' });
    expect(guards.snapshot()).toEqual({});
    expect(guards.tailSections().filter(Boolean)).toEqual([]);
  });
});

describe('LoopGuards — D8 / D7', () => {
  it('offers the read-only port for read tools only', () => {
    const { wrapped } = harness(ON);
    expect(wrapped.ports.isReadOnly?.(call('a', 'read_file', {}))).toBe(true);
    expect(wrapped.ports.isReadOnly?.(call('b', 'write_file', {}))).toBe(false);
  });

  it('notes a broken write on its own tool result, and leaves a clean one alone', async () => {
    const { wrapped } = harness(ON);
    const bad = await wrapped.ports.dispatch(call('a', 'write_file', { path: 'cfg.json', content: '{ "a": ' }), ctx());
    expect(String((bad.data as { note?: string }).note)).toMatch(/Post-edit check FAILED[\s\S]*cfg\.json/);
    const good = await wrapped.ports.dispatch(call('b', 'write_file', { path: 'cfg.json', content: '{ "a": 1 }' }), ctx());
    expect((good.data as { note?: string }).note).toBeUndefined();
  });
});

describe('LoopGuards — D1 cascade', () => {
  it('escalates one tier when a turn\'s edit fails its check, and records a training row', async () => {
    const { guards, wrapped, deps, model } = harness(ON);
    deps.model.set(await guards.seedModel(model(), { strict: false, ladder, features: deps.features(0) }));
    await wrapped.ports.dispatch(call('a', 'write_file', { path: 'cfg.json', content: '{' }), ctx());
    await wrapped.hooks.afterToolCalls!(ctx(2), false);
    expect(model().policy.model).toBe('mid');
    expect(h.outcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ weakModel: 'weak', passed: false, verifier: 'changed_files', executionId: '77' }));
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: 'model.escalated' }));
  });

  it('escalates on a finish the gates refused, but not on CI still running', async () => {
    const { guards, deps, model } = harness(ON);
    deps.model.set(await guards.seedModel(model(), { strict: false, ladder, features: deps.features(0) }));
    expect(await guards.finish({ block: 'CI is still running', reason: 'branch_ci_pending' }, 1, deps)).toBe('CI is still running');
    expect(model().policy.model).toBe('weak');
    expect(await guards.finish({ block: 'stub code', reason: 'placeholders' }, 2, deps)).toBe('stub code');
    expect(model().policy.model).toBe('mid');
    expect(guards.tailSections().join('\n')).toContain('stub code');
  });

  it('starts a soft seed on the weakest tier, unless the difficulty router says skip', async () => {
    const a = harness(ON, 'strong');
    const seeded = await a.guards.seedModel(a.model(), { strict: false, ladder, features: a.deps.features(0) });
    expect(seeded.policy.model).toBe('weak');
    h.skip.mockResolvedValue(true);
    const b = harness(ON, 'strong');
    expect((await b.guards.seedModel(b.model(), { strict: false, ladder, features: b.deps.features(0) })).policy.model).toBe('strong');
    const c = harness(ON, 'strong');
    expect((await c.guards.seedModel(c.model(), { strict: true, ladder, features: c.deps.features(0) })).policy.model).toBe('strong');
  });
});

describe('LoopGuards — A3 progress detector', () => {
  async function revertTurn(w: ReturnType<typeof harness>['wrapped'], step: number) {
    for (const [i, content] of ['A', 'B', 'A'].entries()) {
      const c = call(`c${step}-${i}`, 'write_file', { path: 'notes.md', content });
      const r = await w.ports.dispatch(c, ctx(step));
      await w.hooks.afterDispatch!(c, r, {}, ctx(step));
    }
    await w.hooks.afterToolCalls!(ctx(step), false);
  }

  it('steers on the first trip, escalates on the second, pauses on the third', async () => {
    const { guards, wrapped, deps, model } = harness({ COST_LEVER_A3_PROGRESS_DETECTOR: 'on', COST_LEVER_D1_VERIFIER_CASCADE: 'off' });
    await guards.seedModel(model(), { strict: false, ladder, features: deps.features(0) });
    await revertTurn(wrapped, 1);
    expect(guards.tailSections().join('\n')).toContain('notes.md');
    await revertTurn(wrapped, 2);
    expect(model().policy.model).toBe('mid');
    await revertTurn(wrapped, 3);
    const parked = (await wrapped.hooks.beforeDispatch!(call('x', 'read_file', { path: 'a' }), ctx(4))) as { result?: { control?: unknown } } | undefined;
    expect(parked?.result?.control).toMatchObject({ kind: 'ask_human', approvalId: 'appr-1' });
    expect(deps.pause).toHaveBeenCalledTimes(1);
    // The park is spent: the next call runs.
    expect(await wrapped.hooks.beforeDispatch!(call('y', 'read_file', { path: 'a' }), ctx(4))).toBeUndefined();
  });

  it('keeps its tallies across a durable tick', async () => {
    const env = { COST_LEVER_A3_PROGRESS_DETECTOR: 'on' };
    const first = harness(env);
    for (const [i, content] of ['A', 'B'].entries()) {
      const c = call(`c${i}`, 'write_file', { path: 'n.md', content });
      await first.wrapped.hooks.afterDispatch!(c, await first.wrapped.ports.dispatch(c, ctx()), {}, ctx());
    }
    await first.wrapped.hooks.afterToolCalls!(ctx(), false);
    const resumed = new LoopGuards(env, 3, JSON.parse(JSON.stringify(first.guards.snapshot())));
    const w = resumed.wrap<Row>({}, { complete: vi.fn(), dispatch: vi.fn(async () => ({ data: { ok: true } })) }, first.deps);
    const c = call('c2', 'write_file', { path: 'n.md', content: 'A' });
    await w.hooks.afterDispatch!(c, await w.ports.dispatch(c, ctx()), {}, ctx());
    await w.hooks.afterToolCalls!(ctx(), false);
    expect(resumed.tailSections().join('\n')).toContain('n.md');
  });
});
