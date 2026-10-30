import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './infrastructure/database/connection';
import type { Env } from './env';

const recordOutcome = vi.hoisted(() => vi.fn());
const sweep = vi.hoisted(() => vi.fn());
vi.mock('./application/runtime/cloudOutcomeRow', () => ({ recordTerminalOutcome: recordOutcome }));
vi.mock('./application/runtime/failedRunSweep', () => ({ sweepFailedCloudRun: sweep }));
// The repository itself is not under test: only the hook it is wired with.
vi.mock('./infrastructure/repositories/ExecutionRepository', () => ({
  ExecutionRepository: class { constructor(readonly db: unknown, readonly hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> }) {} },
}));

import { buildExecutionRepository } from './buildExecutionRepository';

const db = {} as Db;
const env = {} as Env;
const saved = { id: 62, status: 'failed', cloudAgentRef: 'bob' };
const hookOf = (repo: unknown) => (repo as { hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> } }).hooks.onTerminal;

beforeEach(() => { recordOutcome.mockReset(); sweep.mockReset(); });

describe('buildExecutionRepository - what a landed terminal status triggers', () => {
  it('records the run\'s outcome row FIRST, then sweeps the branch of a run that landed failed (given an env)', async () => {
    const order: string[] = [];
    recordOutcome.mockImplementation(async () => { order.push('outcome'); });
    sweep.mockImplementation(async () => { order.push('sweep'); });

    await hookOf(buildExecutionRepository(db, env))(saved, { telemetry: { toolCalls: 3 } });

    expect(recordOutcome).toHaveBeenCalledWith(db, saved, { toolCalls: 3 });
    expect(sweep).toHaveBeenCalledWith(env, db, saved);
    expect(order).toEqual(['outcome', 'sweep']);
  });

  it('without an env (a lander that cannot reach the repo provider) only the outcome row is recorded', async () => {
    await hookOf(buildExecutionRepository(db))(saved, {});

    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(sweep).not.toHaveBeenCalled();
  });
});
