/**
 * Settling and refunding a recording pack. The processor read
 * (`verifyPaidCheckout`), the wallet and the trace are mocked; the db is a tiny
 * fake that records the order writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  verifyPaidCheckout: vi.fn(),
  creditReplayPack: vi.fn(),
  refundReplayCredits: vi.fn(),
  loadGrantRows: vi.fn(),
  remainingOfGrant: vi.fn(),
  replayWalletSnapshot: vi.fn(),
  recordReplayTrace: vi.fn(async () => undefined),
  registerObject: vi.fn(async () => undefined),
}));

vi.mock('../finance/verifiedCheckout', () => ({
  verifyPaidCheckout: mocks.verifyPaidCheckout,
  assertCovers: (verified: { amountCents: number }, price: number, message: string, refuse: (m: string, s: 400) => Error) => {
    if (verified.amountCents < price) throw refuse(message, 400);
  },
}));
vi.mock('./replayWallet', () => ({
  creditReplayPack: mocks.creditReplayPack,
  refundReplayCredits: mocks.refundReplayCredits,
  loadGrantRows: mocks.loadGrantRows,
  remainingOfGrant: mocks.remainingOfGrant,
  replayWalletSnapshot: mocks.replayWalletSnapshot,
}));
vi.mock('../replay/replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: {
    paymentCompleted: 'replay.payment.completed',
    creditsAdded: 'replay.credits.added',
    paymentRefunded: 'replay.payment.refunded',
  },
}));
vi.mock('../kernel/ObjectRegistry', () => ({ registerObject: mocks.registerObject }));

import {
  completeReplayPack,
  REPLAY_PACK_ORDER_PREFIX,
  refundReplayPack,
  settleReplayPack,
} from './replayPackSettlement';

/**
 * Selects answer from a queue (catalog read first, then order lookups); inserts
 * and updates are recorded.
 */
function fakeDb(selectAnswers: unknown[][]) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => {
      const chain = { from: () => chain, where: () => chain, limit: async () => selectAnswers.shift() ?? [] };
      return chain;
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        const done = Promise.resolve([{ id: 501 }]);
        return Object.assign(done, {
          onConflictDoNothing: () => ({ returning: async () => [{ id: 501 }] }),
        });
      },
    }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) }),
  };
  return { db: db as unknown as Db, inserts, updates };
}

const env = {} as Env;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.recordReplayTrace.mockResolvedValue(undefined);
  mocks.replayWalletSnapshot.mockResolvedValue({ credits: 10_000, freeUsed: 0, freeRemaining: 5_000, period: '2026-10' });
  mocks.verifyPaidCheckout.mockResolvedValue({
    paymentRef: 'pi_1',
    amountCents: 4_000,
    customerEmail: null,
    metadata: { purchaseKind: 'replay_pack', tenantId: '7', packId: 'p10k', buyerRef: 'u1' },
  });
});

describe('completeReplayPack', () => {
  it('writes an RP- order, credits the pack once and traces payment + credits', async () => {
    const { db, inserts } = fakeDb([[], []]); // catalog: none → D4 ladder; order: none yet
    mocks.creditReplayPack.mockResolvedValue(true);

    const result = await completeReplayPack(db, env, { tenantId: 7, checkoutSessionId: 'cs_live_1' });

    expect(result).toEqual({ applied: true, creditedUnits: 10_000, credits: 10_000, orderId: 501 });
    const order = inserts[0]!;
    expect(String(order.orderNumber)).toMatch(new RegExp(`^${REPLAY_PACK_ORDER_PREFIX}`));
    expect(order).toMatchObject({ tenantId: 7, totalCents: 4_000, status: 'paid', providerRef: 'cs_live_1' });
    expect(mocks.creditReplayPack).toHaveBeenCalledWith(db, env, expect.objectContaining({
      tenantId: 7, units: 10_000, reference: 'replay-pack:cs_live_1', packId: 'p10k', paymentRef: 'pi_1',
    }));
    expect(mocks.recordReplayTrace.mock.calls.map((c) => (c as unknown as [unknown, unknown, { verb: string }])[2].verb))
      .toEqual(['replay.payment.completed', 'replay.credits.added']);
  });

  it('a replayed settlement credits nothing new and traces nothing', async () => {
    const { db } = fakeDb([[], [{ id: 77 }]]); // the order already exists
    mocks.creditReplayPack.mockResolvedValue(false);
    const result = await completeReplayPack(db, env, { tenantId: 7, checkoutSessionId: 'cs_live_1' });
    expect(result.applied).toBe(false);
    expect(result.orderId).toBe(77);
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });

  it('refuses a payment that does not cover the pack', async () => {
    mocks.verifyPaidCheckout.mockResolvedValue({
      paymentRef: 'pi_2', amountCents: 100, customerEmail: null,
      metadata: { purchaseKind: 'replay_pack', tenantId: '7', packId: 'p10k' },
    });
    const { db } = fakeDb([[]]);
    await expect(completeReplayPack(db, env, { tenantId: 7, checkoutSessionId: 'cs_x' })).rejects.toMatchObject({ status: 400 });
    expect(mocks.creditReplayPack).not.toHaveBeenCalled();
  });
});

describe('settleReplayPack', () => {
  it('returns null (unretryable) when the metadata names no tenant', async () => {
    const { db } = fakeDb([]);
    await expect(settleReplayPack(db, env, { checkoutSessionId: 'cs', metadata: {} })).resolves.toBeNull();
    expect(mocks.verifyPaidCheckout).not.toHaveBeenCalled();
  });
});

describe('refundReplayPack', () => {
  it('claws back only the unused remainder and marks the order refunded', async () => {
    const { db, updates } = fakeDb([[{ id: 9, status: 'paid', totalCents: 4_000 }]]);
    mocks.loadGrantRows.mockResolvedValue([]);
    mocks.remainingOfGrant.mockReturnValue(6_500);
    mocks.refundReplayCredits.mockResolvedValue(true);

    const result = await refundReplayPack(db, env, { tenantId: 7, checkoutSessionId: 'cs_live_1', actorId: 'u1' });

    expect(mocks.remainingOfGrant).toHaveBeenCalledWith([], 'replay-pack:cs_live_1', expect.any(Date));
    expect(mocks.refundReplayCredits).toHaveBeenCalledWith(db, env, expect.objectContaining({
      tenantId: 7, units: 6_500, reference: 'replay-pack-refund:cs_live_1',
    }));
    expect(updates[0]).toMatchObject({ status: 'refunded' });
    expect(result).toEqual({ refunded: true, unitsReturned: 6_500, credits: 10_000, refundedCents: 4_000 });
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({
      verb: 'replay.payment.refunded', actorId: 'u1',
    }));
  });

  it('404s an unknown purchase', async () => {
    const { db } = fakeDb([[]]);
    await expect(refundReplayPack(db, env, { tenantId: 7, checkoutSessionId: 'cs_none' })).rejects.toMatchObject({ status: 404 });
  });
});
