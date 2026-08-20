/**
 * A VERIFICATION BADGE IS A PROMISE ABOUT THE NEXT TRANSFER.
 *
 * The ordering assertion below is the one that matters: a destination that paid out
 * successfully once and has been failing ever since must read `failed`, not `verified`.
 * A badge that remembers the last success is a badge that lies about the next attempt,
 * and the person reading it waits for money that is not coming.
 */
import { describe, expect, it } from 'vitest';
import { verificationOf } from './withdrawalMethods';
import type { PayoutAccountView } from '../payouts/PayoutAccountService';

const account = (over: Partial<PayoutAccountView> = {}): PayoutAccountView => ({
  id: 1,
  provider: 'bank',
  label: 'Bank •••• 4321',
  currency: 'USD',
  country: 'GB',
  status: 'connected',
  isDefault: true,
  lastError: null,
  lastPayoutAtISO: null,
  connectedAtISO: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('verificationOf', () => {
  it('is unverified while nothing has moved through it', () => {
    expect(verificationOf(account())).toEqual({
      verification: 'unverified',
      verifiedAtISO: null,
      verificationDetail: null,
    });
  });

  it('is verified once money has actually left through it', () => {
    // The evidence IS the successful payout. Nothing is stored that the rows could
    // contradict — `PayoutAccountService.pay` writes `lastSyncedAt` on success.
    expect(verificationOf(account({ lastPayoutAtISO: '2026-06-01T10:00:00.000Z' }))).toEqual({
      verification: 'verified',
      verifiedAtISO: '2026-06-01T10:00:00.000Z',
      verificationDetail: null,
    });
  });

  it('reports a failure ahead of a stale success', () => {
    const stale = account({
      lastPayoutAtISO: '2026-06-01T10:00:00.000Z',
      lastError: 'Account number rejected by the receiving bank',
    });
    expect(verificationOf(stale)).toEqual({
      verification: 'failed',
      verifiedAtISO: null,
      verificationDetail: 'Account number rejected by the receiving bank',
    });
  });

  it('carries the reason, so "failed" is something a person can act on', () => {
    expect(verificationOf(account({ lastError: 'IBAN checksum invalid' })).verificationDetail)
      .toBe('IBAN checksum invalid');
  });

  it('never invents a verified state from a connected one', () => {
    // Connecting an account is typing a number. It proves nothing about whether money
    // can reach it, and a green badge for it would be the fabrication this avoids.
    expect(verificationOf(account({ status: 'connected' })).verification).toBe('unverified');
  });
});
