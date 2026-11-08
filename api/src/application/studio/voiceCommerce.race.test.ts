/**
 * regression: a refund/dispute reversal interleaved with the purchase completion, in BOTH
 * orders, must leave the seller's net ledger at 0 and the licence revoked.
 *
 *   A. the reversal lands BETWEEN completion's licence read and its sale split (it revokes and
 *      reads an empty ledger; the split then credits the seller).
 *   B. the reversal lands AFTER the split (it reads the rows and reverses them).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerEntries, studioVoiceCloneLicenses, studioVoiceClones } from '../../infrastructure/database/schema';

const verifyPaid = vi.fn();
vi.mock('../../infrastructure/payment', () => ({ buildPaymentProvider: () => ({}) }));
vi.mock('../finance/verifiedCheckout', () => ({
  verifyPaidCheckout: (...a: unknown[]) => verifyPaid(...a),
  assertCovers: () => undefined,
}));
vi.mock('../marketplace/listingCommerce', () => ({ resolveTakeRateBps: async () => ({ bps: 1500 }) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ bumpCacheVersion: async () => undefined }));

type Row = Record<string, unknown>;
const state: { license: Row | null; ledger: Row[]; beforeSplit: (() => Promise<void>) | null } = { license: null, ledger: [], beforeSplit: null };

// The split writes the same two rows the real recordSaleSplit does (unique by reference).
vi.mock('../finance/saleLedger', () => ({
  recordSaleSplit: async (_db: unknown, i: { saleId: number; sellerCents: number; commissionCents: number; referencePrefix: string }) => {
    if (state.beforeSplit) { const hook = state.beforeSplit; state.beforeSplit = null; await hook(); }
    for (const [reference, accountKind, accountRef, amount] of [
      [`${i.referencePrefix}-sale:${i.saleId}`, 'user', 'seller', i.sellerCents],
      [`${i.referencePrefix}-fee:${i.saleId}`, 'partner', 'platform', i.commissionCents],
    ] as const) {
      if (!state.ledger.some((e) => e.reference === reference)) {
        state.ledger.push({ tenantId: 1, accountKind, accountRef, denomination: 'usd_cents', amount: String(amount), reference, memo: 'm' });
      }
    }
  },
}));

import { completeVoiceCheckout, reverseVoicePurchase } from './voiceCommerce';

const clone = { id: 9, tenantId: 1, userId: 'seller', name: 'Alice', visibility: 'marketplace', status: 'published', priceMillicents: 500_000 };

const db = {
  select: () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    chain.from = (t: unknown) => { table = t; return chain; };
    chain.where = () => chain;
    chain.limit = () => Promise.resolve(
      table === studioVoiceClones ? [clone]
        : table === studioVoiceCloneLicenses ? (state.license ? [state.license] : [])
        : [],
    );
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      // the real query is `reference IN (voice-sale:<id>, voice-fee:<id>)` — originals only
      Promise.resolve(table === ledgerEntries ? state.ledger.filter((e) => /^voice-(sale|fee):/.test(String(e.reference))) : []).then(res, rej);
    return chain;
  },
  insert: (table: unknown) => ({
    values: (v: Row | Row[]) => {
      if (table === studioVoiceCloneLicenses) {
        const row = v as Row;
        return {
          // completion's grant: never overwrites an existing row
          onConflictDoNothing: async () => { if (!state.license) state.license = { id: 77, status: 'active', ...row }; },
          // the reversal: revoke (or write a tombstone)
          onConflictDoUpdate: () => ({
            returning: async () => { state.license = { ...(state.license ?? { id: 77, ...row }), status: 'revoked' }; return [{ id: 77 }]; },
          }),
        };
      }
      return {
        onConflictDoNothing: async () => {
          for (const e of v as Row[]) if (!state.ledger.some((x) => x.reference === e.reference)) state.ledger.push(e);
        },
      };
    },
  }),
} as never;

const env = { STRIPE_SECRET_KEY: 'sk' } as never;
const complete = () => completeVoiceCheckout(db, env, { tenantId: 2, buyerUserId: 'b', checkoutSessionId: 'cs_1' });
const reverse = () => reverseVoicePurchase(db, env, { tenantId: 2, cloneId: 9 });
const sellerNet = () => state.ledger.filter((e) => e.accountRef === 'seller').reduce((n, e) => n + Number(e.amount), 0);
const platformNet = () => state.ledger.filter((e) => e.accountRef === 'platform').reduce((n, e) => n + Number(e.amount), 0);

beforeEach(() => {
  state.license = null; state.ledger = []; state.beforeSplit = null;
  verifyPaid.mockReset();
  verifyPaid.mockResolvedValue({ amountCents: 500, paymentRef: 'pi_1', metadata: { cloneId: '9' } });
});

describe('regression: refund vs completion race', () => {
  it('order A — the reversal lands between the licence read and the sale split', async () => {
    state.beforeSplit = async () => { await reverse(); };
    const out = await complete();
    expect(out).toEqual({ applied: false, reason: 'license_revoked' });
    expect(state.license?.status).toBe('revoked');
    expect(sellerNet()).toBe(0);
    expect(platformNet()).toBe(0);
  });

  it('order B — the reversal lands after the split', async () => {
    const out = await complete();
    expect(out).toMatchObject({ applied: true });
    expect(sellerNet()).toBeGreaterThan(0);
    await reverse();
    expect(state.license?.status).toBe('revoked');
    expect(sellerNet()).toBe(0);
    expect(platformNet()).toBe(0);
  });

  it('replaying either side writes nothing twice', async () => {
    state.beforeSplit = async () => { await reverse(); };
    await complete();
    await reverse();
    await complete(); // a redelivered completion over the revoked row grants nothing
    expect(sellerNet()).toBe(0);
    expect(state.ledger.filter((e) => String(e.reference).includes('reversal'))).toHaveLength(2);
  });
});
