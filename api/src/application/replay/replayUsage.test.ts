/**
 * The one usage module over the one wallet (PRD 33 D4): the free pool first, then
 * credits; the per-workspace allowance override; and a unit charged under one
 * reference only ever once. The wallet's ledger functions are mocked — their FIFO
 * and idempotency are `replayWallet.test.ts`'s — and the catalog is the D4 default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wallet: { credits: 0, freeUsed: 0, freeRemaining: 5_000, period: '2026-10' },
  freeMonthly: 0,
  override: null as unknown,
  paidSpent: '0',
  grantRows: [] as Array<{ kind: string; amount: number }>,
  debitReplayFree: vi.fn(async () => true),
  debitReplayCredits: vi.fn(async () => true),
  recordReplayTrace: vi.fn(async () => {}),
}));

vi.mock('../commerce/replayWallet', () => ({
  replayWalletSnapshot: vi.fn(async (_db: unknown, _env: unknown, _tenantId: number, opts: { freeMonthlyUnits: number }) => {
    mocks.freeMonthly = opts.freeMonthlyUnits;
    return { ...mocks.wallet, freeRemaining: Math.max(0, opts.freeMonthlyUnits - mocks.wallet.freeUsed) };
  }),
  debitReplayFree: mocks.debitReplayFree,
  debitReplayCredits: mocks.debitReplayCredits,
  loadGrantRows: vi.fn(async () => mocks.grantRows),
}));
vi.mock('../commerce/replayCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../commerce/replayCatalog')>()),
  loadReplayCatalog: vi.fn(async () => ({ listingId: 'l1', packs: [], freeMonthlyUnits: 5_000 })),
}));
vi.mock('./replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { creditsFirstDebit: 'replay.credits.first_debit', allowanceExhausted: 'replay.allowance.exhausted' },
}));

import { canKeepNewRecording, chargeUnits, freeAllowance, hasUnits, replayUseReference, usageSnapshot } from './replayUsage';

/** Answers the tenants.settings read, then the paid-spend sum, in call order. */
const db = {
  select: (shape: Record<string, unknown>) => ({
    from: () => ({
      where: () => {
        if ('settings' in shape) {
          const settings = mocks.override === null ? null : JSON.stringify({ replayFreeAllowanceOverride: mocks.override });
          return { limit: async () => [{ settings }] };
        }
        return Promise.resolve([{ total: mocks.paidSpent }]);
      },
    }),
  }),
} as never;
const env = {} as never;
const SITE = '11111111-2222-4333-8444-555555555555';
const charge = (unitIndex = 1) => chargeUnits(env, db, { tenantId: 7, siteId: SITE, recordingId: 'rec-1', unitIndex });

beforeEach(() => {
  mocks.wallet = { credits: 0, freeUsed: 0, freeRemaining: 5_000, period: '2026-10' };
  mocks.override = null;
  mocks.paidSpent = '0';
  mocks.grantRows = [];
  mocks.debitReplayFree.mockClear().mockResolvedValue(true);
  mocks.debitReplayCredits.mockClear().mockResolvedValue(true);
  mocks.recordReplayTrace.mockClear();
});

describe('freeAllowance', () => {
  it('is the catalog’s 5,000 by default', async () => {
    expect(await freeAllowance(env, db, 7)).toBe(5_000);
  });

  it('honours replayFreeAllowanceOverride, including 0 (D8)', async () => {
    mocks.override = 0;
    expect(await freeAllowance(env, db, 8)).toBe(0);
    mocks.override = 120;
    expect(await freeAllowance(env, db, 9)).toBe(120);
  });

  it('ignores a malformed override', async () => {
    mocks.override = 'lots';
    expect(await freeAllowance(env, db, 10)).toBe(5_000);
  });
});

describe('chargeUnits', () => {
  it('spends the free pool first, under the unit’s own reference', async () => {
    expect(await charge(1)).toEqual({ charged: true, source: 'free' });
    expect(mocks.debitReplayFree).toHaveBeenCalledWith(db, env, expect.objectContaining({
      tenantId: 7, units: 1, reference: 'replay-use:rec-1:1', period: '2026-10',
    }));
    expect(mocks.debitReplayCredits).not.toHaveBeenCalled();
  });

  it('spends credits once the free pool is gone, and traces the first paid debit', async () => {
    mocks.wallet = { credits: 10_000, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    expect(await charge(2)).toEqual({ charged: true, source: 'credits' });
    expect(mocks.debitReplayCredits).toHaveBeenCalledWith(db, env, expect.objectContaining({ units: 1, reference: 'replay-use:rec-1:2' }));
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({ verb: 'replay.credits.first_debit', siteId: SITE }));
  });

  it('does not re-trace the first debit once a paid spend exists', async () => {
    mocks.wallet = { credits: 10_000, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    mocks.grantRows = [{ kind: 'spend', amount: -1 }];
    await charge(1);
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });

  it('reports a retried unit as not charged (the ledger reference already exists)', async () => {
    mocks.debitReplayFree.mockResolvedValue(false);
    expect(await charge(1)).toEqual({ charged: false, source: 'free' });
  });

  it('leaves a unit uncharged and traces exhaustion when nothing is left', async () => {
    mocks.wallet = { credits: 0, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    expect(await charge(3)).toEqual({ charged: false, source: null });
    expect(mocks.debitReplayFree).not.toHaveBeenCalled();
    expect(mocks.debitReplayCredits).not.toHaveBeenCalled();
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({ verb: 'replay.allowance.exhausted' }));
  });

  it('names the reference deterministically', () => {
    expect(replayUseReference('abc', 4)).toBe('replay-use:abc:4');
  });
});

describe('canKeepNewRecording', () => {
  it('is true with free units or credits, false with neither', async () => {
    expect(await canKeepNewRecording(env, db, 7)).toBe(true);
    mocks.wallet = { credits: 3, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    expect(await canKeepNewRecording(env, db, 11)).toBe(true);
    mocks.wallet = { credits: 0, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    expect(await canKeepNewRecording(env, db, 12)).toBe(false);
  });

  it('applies the override: 0 free means a new recording needs credits', async () => {
    mocks.override = 0;
    expect(await canKeepNewRecording(env, db, 13)).toBe(false);
  });
});

describe('usageSnapshot', () => {
  it('reports free and paid use against the free allowance plus everything bought this period', async () => {
    // 10,000 bought, 1,000 spent → 9,000 left; limit - used must equal what ingest still allows (9,000).
    mocks.wallet = { credits: 9_000, freeUsed: 5_000, freeRemaining: 0, period: '2026-10' };
    mocks.paidSpent = '-1000';
    expect(await usageSnapshot(env, db, 14)).toEqual({
      period: '2026-10',
      freeAllowance: 5_000,
      freeUsed: 5_000,
      credits: 9_000,
      used: 6_000,
      limit: 15_000,
    });
  });
});

describe('a multi-unit charge (an MP4 export, 10 units)', () => {
  const exportCharge = () => chargeUnits(env, db, {
    tenantId: 7, siteId: SITE, recordingId: 'rec-1', unitIndex: 0, units: 10, reference: 'replay-export:e1', memo: 'Insights export e1',
  });

  it('spends all 10 from the free pool in one write under its own reference', async () => {
    expect(await exportCharge()).toEqual({ charged: true, source: 'free' });
    expect(mocks.debitReplayFree).toHaveBeenCalledTimes(1);
    expect(mocks.debitReplayFree).toHaveBeenCalledWith(db, env, expect.objectContaining({
      units: 10, reference: 'replay-export:e1', memo: 'Insights export e1',
    }));
  });

  it('takes them from credits when the free pool cannot cover all 10', async () => {
    mocks.wallet = { credits: 50, freeUsed: 4_995, freeRemaining: 5, period: '2026-10' };
    expect(await exportCharge()).toEqual({ charged: true, source: 'credits' });
    expect(mocks.debitReplayFree).not.toHaveBeenCalled();
    expect(mocks.debitReplayCredits).toHaveBeenCalledWith(db, env, expect.objectContaining({ units: 10, reference: 'replay-export:e1' }));
  });

  it('never splits across pools, and does not claim the allowance is exhausted', async () => {
    mocks.wallet = { credits: 5, freeUsed: 4_995, freeRemaining: 5, period: '2026-10' };
    expect(await exportCharge()).toEqual({ charged: false, source: null });
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });
});

describe('hasUnits', () => {
  it('is true only when ONE pool covers the units', async () => {
    expect(await hasUnits(env, db, 7, 10)).toBe(true);
    mocks.wallet = { credits: 5, freeUsed: 4_995, freeRemaining: 5, period: '2026-10' };
    expect(await hasUnits(env, db, 15, 10)).toBe(false);
    expect(await hasUnits(env, db, 16, 5)).toBe(true);
  });
});
