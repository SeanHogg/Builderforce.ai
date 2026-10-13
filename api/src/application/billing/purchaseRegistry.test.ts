import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settleReplayPack: vi.fn(),
  refundReplayPackOrder: vi.fn(),
}));

vi.mock('../commerce/replayPackSettlement', () => ({
  REPLAY_PACK_ORDER_PREFIX: 'RP-',
  settleReplayPack: mocks.settleReplayPack,
  refundReplayPackOrder: mocks.refundReplayPackOrder,
}));

import { oneOffSettlerFor, orderRefunderFor } from './purchaseRegistry';
import { REPLAY_PACK_KIND } from '../commerce/replayPacks';

const db = {} as never;
const env = {} as never;

beforeEach(() => {
  mocks.settleReplayPack.mockReset();
  mocks.refundReplayPackOrder.mockReset();
});

describe('purchase registry — Insights recording packs', () => {
  it('registers a one-off settler for replay_pack that delegates to settleReplayPack', async () => {
    expect(REPLAY_PACK_KIND).toBe('replay_pack');
    const settler = oneOffSettlerFor(REPLAY_PACK_KIND);
    expect(settler).not.toBeNull();
    mocks.settleReplayPack.mockResolvedValue(true);
    const settlement = { checkoutSessionId: 'cs_1', tenantId: 7, metadata: { packId: 'p10k' } };
    await expect(settler!(db, env, settlement)).resolves.toBe(true);
    expect(mocks.settleReplayPack).toHaveBeenCalledWith(db, env, settlement);
  });

  it('passes an unretryable null straight through', async () => {
    mocks.settleReplayPack.mockResolvedValue(null);
    await expect(oneOffSettlerFor(REPLAY_PACK_KIND)!(db, env, { checkoutSessionId: 'cs_2', metadata: {} })).resolves.toBeNull();
  });

  it('routes an RP- order to the pack refunder, and leaves marketplace orders alone', async () => {
    const refunder = orderRefunderFor('RP-cs1234');
    expect(refunder).not.toBeNull();
    mocks.refundReplayPackOrder.mockResolvedValue({ refundedCents: 4_000 });
    await expect(refunder!(db, env, { tenantId: 7, orderId: 11, actorRef: 'u1' })).resolves.toEqual({ refundedCents: 4_000 });
    expect(mocks.refundReplayPackOrder).toHaveBeenCalledWith(db, env, { tenantId: 7, orderId: 11, actorRef: 'u1' });

    expect(orderRefunderFor('MP-ABC-1234')).toBeNull();
    expect(orderRefunderFor(null)).toBeNull();
    expect(orderRefunderFor('')).toBeNull();
  });

  it('keeps the kinds that settle only on their redirect unregistered', () => {
    expect(oneOffSettlerFor('no_such_kind')).toBeNull();
    expect(oneOffSettlerFor(undefined)).toBeNull();
  });
});
