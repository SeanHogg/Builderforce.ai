import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './infrastructure/database/connection';

const recordOutcome = vi.hoisted(() => vi.fn());
vi.mock('./application/runtime/cloudOutcomeRow', () => ({ recordTerminalOutcome: recordOutcome }));
// The repository itself is not under test: only the hook it is wired with.
vi.mock('./infrastructure/repositories/ExecutionRepository', () => ({
  ExecutionRepository: class { constructor(readonly db: unknown, readonly hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> }) {} },
}));

import { buildExecutionRepository } from './buildExecutionRepository';

const db = {} as Db;
const saved = { id: 62, status: 'failed', cloudAgentRef: 'bob' };
const hookOf = (repo: unknown) => (repo as { hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> } }).hooks.onTerminal;

beforeEach(() => { recordOutcome.mockReset(); });

describe('buildExecutionRepository - what a landed terminal status triggers', () => {
  it('records the run\'s outcome row, once, with the landed row and its telemetry', async () => {
    await hookOf(buildExecutionRepository(db))(saved, { telemetry: { toolCalls: 3 } });

    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledWith(db, saved, { toolCalls: 3 });
  });
});
