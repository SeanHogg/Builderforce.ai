/**
 * PRD 09 D6 / D8 / B3: the human-dispatch admission decides in a fixed order and each
 * refusal carries what the caller needs to act on it. The cap and budget evaluators have
 * their own tests; here they are stubbed so only the ORDER and the response shapes show.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const enforceConcurrentRunCap = vi.fn();
const checkRunBudgetViable = vi.fn();
vi.mock('./concurrentRunCap', () => ({ enforceConcurrentRunCap: (...a: unknown[]) => enforceConcurrentRunCap(...a) }));
vi.mock('./runBudgetEstimate', () => ({ checkRunBudgetViable: (...a: unknown[]) => checkRunBudgetViable(...a) }));

import { admitHumanDispatch } from './humanDispatchAdmission';
import { findLiveExecutionForTask } from './dispatchAdmission';

function dbReturning(rows: Array<{ id: number; status: string }>): Db {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return { select: () => chain } as unknown as Db;
}

const env = {} as Env;
const req = { tenantId: 7, taskId: 11, userId: 'u1', cloudBound: true };

beforeEach(() => {
  enforceConcurrentRunCap.mockReset().mockResolvedValue({ allowed: true });
  checkRunBudgetViable.mockReset().mockResolvedValue(null);
});

describe('admitHumanDispatch', () => {
  it('admits a task with no live run under the cap and budget', async () => {
    expect(await admitHumanDispatch(env, dbReturning([]), req)).toBeNull();
  });

  it('refuses a second live run for the same task with 409 naming the live execution (D6)', async () => {
    const refusal = await admitHumanDispatch(env, dbReturning([{ id: 321, status: 'running' }]), req);
    expect(refusal?.status).toBe(409);
    expect(refusal?.body).toMatchObject({ code: 'execution_already_live', executionId: 321, taskId: 11 });
    expect(enforceConcurrentRunCap).not.toHaveBeenCalled();
  });

  it('a paused (parked) run still counts as live, matching the autonomy evaluator', async () => {
    const refusal = await admitHumanDispatch(env, dbReturning([{ id: 5, status: 'paused' }]), req);
    expect(refusal?.status).toBe(409);
  });

  it('does not treat a finished run as live', async () => {
    expect(await findLiveExecutionForTask(dbReturning([{ id: 5, status: 'completed' }]), 7, 11)).toBeNull();
  });

  it('refuses over the concurrent cap with 429 carrying the cap and the current count (D8)', async () => {
    enforceConcurrentRunCap.mockResolvedValue({ allowed: false, effectivePlan: 'free', used: 2, limit: 2 });
    const refusal = await admitHumanDispatch(env, dbReturning([]), req);
    expect(refusal?.status).toBe(429);
    expect(refusal?.body).toMatchObject({ code: 'concurrent_run_limit', limit: 2, current: 2, effectivePlan: 'free' });
    expect(checkRunBudgetViable).not.toHaveBeenCalled();
  });

  it('refuses a run the remaining allowance cannot fund with 429 (B3)', async () => {
    checkRunBudgetViable.mockResolvedValue({ code: 'insufficient_run_budget', error: 'low', remainingTokens: 10, minimumTokens: 5000, window: 'daily', effectivePlan: 'free' });
    const refusal = await admitHumanDispatch(env, dbReturning([]), req);
    expect(refusal?.status).toBe(429);
    expect(refusal?.body).toMatchObject({ code: 'insufficient_run_budget', remainingTokens: 10, minimumTokens: 5000 });
  });

  it('passes the acting user to the budget check so a superadmin is not floor-gated', async () => {
    await admitHumanDispatch(env, dbReturning([]), req);
    expect(checkRunBudgetViable).toHaveBeenCalledWith(expect.anything(), 7, { actingUserId: 'u1' }, env);
  });

  it('skips the cloud-only cap and budget floor for a host-pinned / editor run, but still dedupes', async () => {
    const hostRun = { ...req, cloudBound: false };
    expect(await admitHumanDispatch(env, dbReturning([]), hostRun)).toBeNull();
    expect(enforceConcurrentRunCap).not.toHaveBeenCalled();
    expect(checkRunBudgetViable).not.toHaveBeenCalled();
    expect((await admitHumanDispatch(env, dbReturning([{ id: 9, status: 'pending' }]), hostRun))?.status).toBe(409);
  });
});
