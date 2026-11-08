import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const recordSignoff = vi.fn(async (..._a: unknown[]) => ({ signoffId: 'so-1' }));
vi.mock('../audit/ticketAuditService', () => ({
  TicketAuditService: class { recordSignoff = recordSignoff; },
}));
vi.mock('./ticketParticipants', () => ({
  TicketParticipantsService: class { syncStates = vi.fn(async () => {}); invalidate = vi.fn(async () => {}); },
}));

import { bridgeValidatorReview, invalidateStaleAcceptance } from './validatorSlotBridge';

/** A chainable fake: every select resolves to the next queued result; update is a no-op. */
function fakeDb(selects: unknown[][]): Db {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ['from', 'where', 'orderBy']) c[k] = () => c;
    c.limit = async () => rows;
    c.then = (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res);
    return c;
  };
  return {
    select: () => chain(selects.shift() ?? []),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Db;
}

const slot = { id: 's1', stageKey: 'in_review', roleKey: 'validator', responsibility: 'reviewer', required: true, state: 'assigned', createdAt: new Date() };
const args = { tenantId: 1, taskId: 5, reviewId: 11, verdict: 'complete', reviewerRef: 'v', summary: 'ok' };

beforeEach(() => recordSignoff.mockClear());

describe('bridged Validator review posts to the PR exactly once', () => {
  it('records the sign-off with PR publishing suppressed (publishReviewToPr is the one publisher)', async () => {
    const r = await bridgeValidatorReview({} as Env, fakeDb([[slot], []]), args);
    expect(r.signoffId).toBe('so-1');
    expect(recordSignoff).toHaveBeenCalledTimes(1);
    expect(recordSignoff.mock.calls[0]![2]).toMatchObject({ roleKey: 'validator', publishToPr: false });
  });

  it('a replay records nothing at all (idempotent)', async () => {
    await bridgeValidatorReview({} as Env, fakeDb([[slot], [{ id: 'existing' }]]), args);
    expect(recordSignoff).not.toHaveBeenCalled();
  });
});

describe('stale-acceptance invalidation never mirrors onto the PR', () => {
  it('records the changes_requested row with publishToPr:false', async () => {
    const reviews = [{ id: 11, taskId: 5, participantId: 's1', reviewedHeadSha: 'aaaaaaa1', verdict: 'complete' }];
    const slots = [{ id: 's1', stageKey: 'in_review', state: 'completed' }];
    const reopened = await invalidateStaleAcceptance({} as Env, fakeDb([reviews, slots]), 1, [{ taskId: 5, headSha: 'bbbbbbb2' }]);
    expect(reopened).toEqual([5]);
    expect(recordSignoff).toHaveBeenCalledTimes(1);
    expect(recordSignoff.mock.calls[0]![2]).toMatchObject({ verdict: 'changes_requested', publishToPr: false });
  });
});
