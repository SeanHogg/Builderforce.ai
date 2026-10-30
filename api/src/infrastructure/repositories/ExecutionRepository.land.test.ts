/**
 * ExecutionRepository.land - THE terminal transition. Conditional on a non-terminal status (one winner), the outcome owner is
 * told only of a win, `update()` refuses a terminal status and cannot resurrect a terminal row, `setProduced` never touches status.
 */
import { describe, expect, it, vi } from 'vitest';
import { ExecutionStatus, asExecutionId } from '../../domain/shared/types';
import { ExecutionRepository, TerminalStatusViaUpdateError } from './ExecutionRepository';
import { Execution } from '../../domain/execution/Execution';

const row = (status: string) => ({
  id: 9, taskId: 3, agentId: null, agentRegistrationId: null, agentHostId: null, tenantId: 4, submittedBy: 'u1', sessionId: null, status,
  payload: null, source: 'agent', cloudAgentRef: null, result: null, errorMessage: null, produced: null, startedAt: null, completedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0),
});

/** A db whose UPDATE ... WHERE <non-terminal> answers `updated` (one row, or none when another writer got there first); SELECT answers `current`. */
function fakeDb(opts: { updated: Array<ReturnType<typeof row>>; current?: ReturnType<typeof row> }) {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); return { where: () => ({ returning: async () => opts.updated }) }; } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (opts.current ? [opts.current] : []) }) }) }),
  } as never;
  return { db, sets };
}

describe('land()', () => {
  it('a run that is not yet terminal is landed once: the row is returned and the outcome owner is told', async () => {
    const onTerminal = vi.fn(async () => undefined);
    const { db, sets } = fakeDb({ updated: [row('completed')] });
    const landed = await new ExecutionRepository(db, { onTerminal }).land(asExecutionId(9), ExecutionStatus.COMPLETED, { result: 'done' });
    expect(landed.won).toBe(true);
    expect(landed.execution.status).toBe('completed');
    expect(sets[0]).toMatchObject({ status: 'completed', result: 'done' });
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('a run another writer already landed is LOST: the winner\'s row is returned and nothing fires', async () => {
    const onTerminal = vi.fn(async () => undefined);
    const { db } = fakeDb({ updated: [], current: row('completed') });
    const landed = await new ExecutionRepository(db, { onTerminal }).land(asExecutionId(9), ExecutionStatus.CANCELLED);
    expect(landed.won).toBe(false);
    expect(landed.execution.status).toBe('completed');
    expect(onTerminal).not.toHaveBeenCalled();
  });
});

describe('update()', () => {
  it('refuses a terminal status: callers must land it', async () => {
    const { db } = fakeDb({ updated: [row('completed')] });
    const done = Execution.reconstitute({ ...row('completed'), id: 9, taskId: 3, tenantId: 4 } as never);
    await expect(new ExecutionRepository(db).update(done)).rejects.toBeInstanceOf(TerminalStatusViaUpdateError);
  });

  it('a stale non-terminal write cannot resurrect a terminal row: the terminal row stands', async () => {
    const { db } = fakeDb({ updated: [], current: row('cancelled') });
    const stale = Execution.reconstitute({ ...row('running'), id: 9, taskId: 3, tenantId: 4 } as never);
    const saved = await new ExecutionRepository(db).update(stale);
    expect(saved.status).toBe('cancelled');
  });
});

describe('setProduced()', () => {
  it('writes the verdict without touching the status', async () => {
    const { db, sets } = fakeDb({ updated: [row('completed')] });
    await new ExecutionRepository(db).setProduced(asExecutionId(9), true);
    expect(sets[0]).toMatchObject({ produced: true });
    expect(sets[0]).not.toHaveProperty('status');
  });
});
