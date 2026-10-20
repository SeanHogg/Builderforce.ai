/**
 * Two concurrent decides both pass the prior `pending` read; the UPDATE is the
 * claim. These pin that the decide that loses the claim (0 rows returned) gets a
 * 409 and runs NO side effect — no resume, no domain handler, no relay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted: vi.mock factories run before module-level consts are initialised.
const { resumePausedExecution, handler } = vi.hoisted(() => ({
  resumePausedExecution: vi.fn(async () => undefined),
  handler: vi.fn(async () => undefined),
}));
vi.mock('../runtime/executionResume', () => ({ resumePausedExecution }));
vi.mock('../runtime/executionStateVersion', () => ({ bumpExecutionState: vi.fn(async () => undefined) }));
vi.mock('./approvalDecisionHandlers', () => ({ approvalDecisionHandlerFor: () => handler }));
vi.mock('./requestApproval', () => ({ relayApprovalEvent: vi.fn() }));

import { decideApproval } from './decideApproval';

const pendingRow = {
  id: 'a1', tenantId: 7, status: 'pending', kind: 'question', actionType: 'synapse.step',
  requestedBy: 'u1', executionId: 99, agentHostId: null, metadata: null, description: 'click',
};

function fakeDb(claimRows: unknown[]) {
  const updateWhere = vi.fn(() => ({ returning: () => Promise.resolve(claimRows) }));
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([pendingRow]) }) }),
    update: () => ({ set: () => ({ where: updateWhere }) }),
  };
  return { db: db as never, updateWhere };
}

const input = {
  tenantId: 7, segmentId: null, approvalId: 'a1',
  actor: { userId: 'u1', role: 'developer', isManager: false },
  status: 'answered', responseText: 'use postgres',
  runtimeService: {} as never, waitUntil: () => undefined,
};

describe('decideApproval claim', () => {
  beforeEach(() => { resumePausedExecution.mockClear(); handler.mockClear(); });

  it('returns 409 and runs no side effect when another decide claimed the row first', async () => {
    const { db } = fakeDb([]);
    const result = await decideApproval(db, {} as never, input);
    expect(result).toEqual({ ok: false, httpStatus: 409, error: 'Request is not pending' });
    expect(resumePausedExecution).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the side effects exactly once for the decide that wins the claim', async () => {
    const { db, updateWhere } = fakeDb([{ id: 'a1' }]);
    const result = await decideApproval(db, {} as never, input);
    expect(result.ok).toBe(true);
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(resumePausedExecution).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
