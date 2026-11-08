import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

const mocks = vi.hoisted(() => ({
  executionEnabled: vi.fn(),
  findActiveTicketRunByTask: vi.fn(),
  resolveTenantTokenGate: vi.fn(),
  recordAutoRunSkip: vi.fn(),
}));
vi.mock('../runtime/agentExecutionGate', () => ({ agentExecutionEnabledCached: mocks.executionEnabled }));
vi.mock('./DrizzleCoordinatorStore', () => ({
  DrizzleCoordinatorStore: class { findActiveTicketRunByTask = mocks.findActiveTicketRunByTask; },
}));
vi.mock('../runtime/autoRunSkipLedger', () => ({ recordAutoRunSkip: mocks.recordAutoRunSkip }));
// The REAL breaker / cooldown stay in play (that is the point: the coordinator reuses them); only the token lookup is stubbed.
vi.mock('./evaluateAutoRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./evaluateAutoRun')>()),
  resolveTenantTokenGate: mocks.resolveTenantTokenGate,
}));

import { admitStageEntry, recordStageRefusal } from './laneCoordinatorAdmission';

const env = {} as Env;
const db = {} as Db;
const input = { tenantId: 1, boardId: 'board-1', taskId: 169 };

const exec = (status: string, over: Record<string, unknown> = {}) => ({
  toPlain: () => ({ id: 1, status, errorMessage: status === 'failed' ? 'assertion failed in tests' : null, createdAt: new Date(0), ...over }),
});
const runtimeWith = (...execs: Array<ReturnType<typeof exec>>) =>
  ({ listByTask: vi.fn().mockResolvedValue(execs) }) as unknown as RuntimeService;
const failures = (n: number) => Array.from({ length: n }, () => exec('failed'));

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.executionEnabled.mockResolvedValue(true);
  mocks.findActiveTicketRunByTask.mockResolvedValue(null);
  mocks.resolveTenantTokenGate.mockResolvedValue({ hasTokens: true });
  mocks.recordAutoRunSkip.mockResolvedValue(true);
});

describe('admitStageEntry', () => {
  it('admits a ticket with no run and no history', async () => {
    expect(await admitStageEntry(env, db, runtimeWith(), input)).toEqual({ admitted: true });
  });

  it('admits a queued run', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'queued' });
    expect(await admitStageEntry(env, db, runtimeWith(), input)).toEqual({ admitted: true });
  });

  it('blocks a needs_attention re-run once the failure breaker has tripped', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'needs_attention' });
    const verdict = await admitStageEntry(env, db, runtimeWith(...failures(3)), input);
    expect(verdict).toMatchObject({ admitted: false, reason: 'run_cap_exhausted' });
  });

  it('blocks a needs_attention re-run inside the cooldown window', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'needs_attention' });
    const justFailed = exec('failed', { completedAt: new Date() });
    const verdict = await admitStageEntry(env, db, runtimeWith(justFailed), input);
    expect(verdict).toMatchObject({ admitted: false, reason: 'cooldown_active' });
    expect((verdict as { cooldownRemainingMs?: number }).cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('admits a needs_attention retry once the breaker and cooldown pass', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'needs_attention' });
    expect(await admitStageEntry(env, db, runtimeWith(exec('failed')), input)).toEqual({ admitted: true });
  });

  describe('a stage that fails without leaving an execution row', () => {
    const history = (...statuses: string[]) => JSON.stringify(statuses.map((status) => ({ swimlaneId: 'l1', workflowId: null, status, at: new Date(Date.now() - 3_600_000 * 5).toISOString() })));

    it('is not retried once the stage-failure streak trips the breaker', async () => {
      mocks.findActiveTicketRunByTask.mockResolvedValue({
        lifecycle: 'needs_attention',
        stageHistory: history('queued', 'stage_running', 'failed', 'stage_running', 'failed', 'stage_running', 'failed'),
      });
      // No executions at all: the executions-only breaker would have admitted this on every tick.
      expect(await admitStageEntry(env, db, runtimeWith(), input)).toMatchObject({ admitted: false, reason: 'run_cap_exhausted' });
    });

    it('backs off inside the cooldown after a single recent stage failure', async () => {
      mocks.findActiveTicketRunByTask.mockResolvedValue({
        lifecycle: 'needs_attention',
        stageHistory: JSON.stringify([{ swimlaneId: 'l1', workflowId: null, status: 'failed', at: new Date().toISOString() }]),
      });
      const verdict = await admitStageEntry(env, db, runtimeWith(), input);
      expect(verdict).toMatchObject({ admitted: false, reason: 'cooldown_active' });
    });

    it('a completed stage breaks the streak', async () => {
      mocks.findActiveTicketRunByTask.mockResolvedValue({
        lifecycle: 'needs_attention',
        stageHistory: history('failed', 'failed', 'failed', 'completed', 'stage_running'),
      });
      expect(await admitStageEntry(env, db, runtimeWith(), input)).toEqual({ admitted: true });
    });

    it('an explicit force ignores the stage-failure streak', async () => {
      mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'needs_attention', stageHistory: history('failed', 'failed', 'failed') });
      expect(await admitStageEntry(env, db, runtimeWith(), { ...input, force: true })).toEqual({ admitted: true });
    });
  });

  it('never relaunches a stage parked at awaiting_gate', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'awaiting_gate' });
    expect(await admitStageEntry(env, db, runtimeWith(), input)).toMatchObject({ admitted: false, reason: 'human_gate' });
  });

  it.each(['stage_running', 'advancing', 'stage_completed', 'awaiting_workflow'])('does not re-enter a %s run', async (lifecycle) => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle });
    expect(await admitStageEntry(env, db, runtimeWith(), input)).toMatchObject({ admitted: false, reason: 'already_running' });
  });

  it('refuses a ticket with a live execution', async () => {
    expect(await admitStageEntry(env, db, runtimeWith(exec('running')), input)).toMatchObject({ admitted: false, reason: 'already_running' });
  });

  it('refuses when the workspace is out of tokens', async () => {
    mocks.resolveTenantTokenGate.mockResolvedValue({ hasTokens: false });
    expect(await admitStageEntry(env, db, runtimeWith(), input)).toMatchObject({ admitted: false, reason: 'tenant_token_limit' });
  });

  it('passes the caller\'s pre-resolved token verdict to the shared gate', async () => {
    const tenantTokens = { hasTokens: true } as never;
    await admitStageEntry(env, db, runtimeWith(), { ...input, tenantTokens });
    expect(mocks.resolveTenantTokenGate).toHaveBeenCalledWith(db, 1, tenantTokens, env);
  });

  it('refuses when agent execution is switched off — even for an explicit force', async () => {
    mocks.executionEnabled.mockResolvedValue(false);
    expect(await admitStageEntry(env, db, runtimeWith(), { ...input, force: true })).toMatchObject({ admitted: false, reason: 'execution_disabled' });
  });

  it('an explicit force overrides the lifecycle restriction, breaker and cooldown (as Run now does)', async () => {
    mocks.findActiveTicketRunByTask.mockResolvedValue({ lifecycle: 'awaiting_gate' });
    expect(await admitStageEntry(env, db, runtimeWith(...failures(3)), { ...input, force: true })).toEqual({ admitted: true });
  });
});

describe('recordStageRefusal', () => {
  const base = { tenantId: 1, taskId: 169, lane: 'in_progress', submittedBy: 'system:auto-exec' };

  it('writes the auto_run_skipped ledger row and tells onBlocked the reason', async () => {
    const onBlocked = vi.fn();
    await recordStageRefusal(env, db, { ...base, onBlocked }, { admitted: false, reason: 'cooldown_active', cooldownRemainingMs: 5000 });

    expect(mocks.recordAutoRunSkip).toHaveBeenCalledWith(env, db, expect.objectContaining({
      tenantId: 1, taskId: 169, lane: 'in_progress', reason: 'cooldown_active',
    }));
    expect(onBlocked).toHaveBeenCalledWith({ reason: 'cooldown_active', cooldownRemainingMs: 5000 });
  });

  it('still reports to onBlocked when the ledger write fails', async () => {
    mocks.recordAutoRunSkip.mockRejectedValue(new Error('kv down'));
    const onBlocked = vi.fn();
    await recordStageRefusal(env, db, { ...base, onBlocked }, { admitted: false, reason: 'tenant_token_limit' });
    expect(onBlocked).toHaveBeenCalledWith({ reason: 'tenant_token_limit' });
  });
});
