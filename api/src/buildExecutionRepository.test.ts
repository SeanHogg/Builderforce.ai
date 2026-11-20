import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './infrastructure/database/connection';

const recordOutcome = vi.hoisted(() => vi.fn());
vi.mock('./application/runtime/cloudOutcomeRow', () => ({ recordTerminalOutcome: recordOutcome }));
const voidGrant = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./application/runtime/mergeGrants', () => ({ voidUnboundGrantOnTerminal: voidGrant }));
// The repository itself is not under test: only the hook it is wired with.
vi.mock('./infrastructure/repositories/ExecutionRepository', () => ({
  ExecutionRepository: class { constructor(readonly db: unknown, readonly hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> }) {} },
}));

import { buildExecutionRepository } from './buildExecutionRepository';

const db = {} as Db;
// The hook receives the landed `Execution` (the repository's `onTerminal(saved: Execution)` contract), so the fake carries `toPlain`.
const saved = { id: 62, status: 'failed', cloudAgentRef: 'bob', toPlain: () => ({ id: 62, tenantId: 7, status: 'failed' }) };
const hookOf = (repo: unknown) => (repo as { hooks: { onTerminal: (saved: unknown, context: { telemetry?: object }) => Promise<void> } }).hooks.onTerminal;

beforeEach(() => { recordOutcome.mockReset(); voidGrant.mockClear(); });

describe('buildExecutionRepository - what a landed terminal status triggers', () => {
  it('records the run\'s outcome row, once, with the landed row and its telemetry', async () => {
    await hookOf(buildExecutionRepository(db))(saved, { telemetry: { toolCalls: 3 } });

    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledWith(db, saved, { toolCalls: 3 });
  });

  it('voids the run\'s unbound merge grant (PRD 48 §4.6) from the landed row', async () => {
    await hookOf(buildExecutionRepository(db))(saved, {});

    expect(voidGrant).toHaveBeenCalledTimes(1);
    expect(voidGrant).toHaveBeenCalledWith(db, { id: 62, tenantId: 7, status: 'failed' });
  });
});
