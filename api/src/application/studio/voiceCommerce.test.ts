import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.fn();
vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ createOneTimeCheckoutSession: (...a: unknown[]) => createSession(...a) }),
}));
const verifyPaid = vi.fn();
vi.mock('../finance/verifiedCheckout', () => ({
  verifyPaidCheckout: (...a: unknown[]) => verifyPaid(...a),
  assertCovers: (v: { amountCents: number }, price: number, msg: string, refuse: (m: string, s: 400) => Error) => {
    if (v.amountCents < price) throw refuse(msg, 400);
  },
}));
const split = vi.fn();
vi.mock('../finance/saleLedger', () => ({ recordSaleSplit: (...a: unknown[]) => split(...a) }));
vi.mock('../marketplace/listingCommerce', () => ({ resolveTakeRateBps: async () => ({ bps: 1500 }) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ bumpCacheVersion: async () => undefined }));

import { completeVoiceCheckout, reverseVoicePurchase, startVoiceCheckout, VOICE_PURCHASE_KIND, voicePriceCents } from './voiceCommerce';

const listed = {
  id: 9, tenantId: 1, userId: 'seller', name: 'Alice', visibility: 'marketplace', status: 'published', priceMillicents: 500_000,
};

function fakeDb(clone: Record<string, unknown> | undefined, license: Record<string, unknown> | undefined) {
  const inserts: unknown[] = [];
  return {
    inserts,
    db: {
      select: () => {
        let isLicense = false;
        const chain: Record<string, unknown> = {};
        chain.from = (t: { id?: unknown }) => { isLicense = 'cloneId' in (t as object); return chain; };
        chain.where = () => chain;
        chain.limit = () => Promise.resolve(isLicense ? (license ? [license] : []) : (clone ? [clone] : []));
        return chain;
      },
      insert: () => ({
        values: (v: unknown) => { inserts.push(v); return { onConflictDoNothing: () => Promise.resolve() }; },
      }),
    } as never,
  };
}

// APP_URL is the web origin a checkout returns to when no returnUrl is named (trustedReturnUrl).
const env = { STRIPE_SECRET_KEY: 'sk', CORS_ORIGINS: 'https://app.test', APP_URL: 'https://app.test' } as never;

beforeEach(() => { createSession.mockReset(); verifyPaid.mockReset(); split.mockReset(); });

describe('voice commerce', () => {
  it('prices in whole cents, rounding a sub-cent price up', () => {
    expect(voicePriceCents({ priceMillicents: 500_000 })).toBe(500);
    expect(voicePriceCents({ priceMillicents: 1 })).toBe(1);
    expect(voicePriceCents({ priceMillicents: 0 })).toBe(0);
  });

  it('starts the shared hosted checkout for a priced voice and grants nothing', async () => {
    createSession.mockResolvedValue({ checkoutUrl: 'https://pay.example/s' });
    const { db, inserts } = fakeDb(listed, undefined);
    const out = await startVoiceCheckout(db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9, returnUrl: 'https://app.test/marketplace/voices' });
    expect(out.checkoutUrl).toBe('https://pay.example/s');
    expect(createSession.mock.calls[0]![0]).toMatchObject({
      amountCents: 500,
      metadata: { purchaseKind: VOICE_PURCHASE_KIND, cloneId: '9', buyerTenantId: '2', buyerUserId: 'b' },
    });
    expect(inserts).toHaveLength(0);
  });

  it('refuses: own voice, already licensed, free voice', async () => {
    await expect(startVoiceCheckout(fakeDb(listed, undefined).db, env, { tenantId: 1, buyerUserId: 'b', cloneId: 9, returnUrl: 'https://a.test/x' })).rejects.toThrow(/own/);
    await expect(startVoiceCheckout(fakeDb(listed, { id: 3 }).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9, returnUrl: 'https://a.test/x' })).rejects.toThrow(/own/);
    await expect(startVoiceCheckout(fakeDb({ ...listed, priceMillicents: 0 }, undefined).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9, returnUrl: 'https://a.test/x' })).rejects.toThrow(/free/);
  });

  it('completes a verified paid checkout: license granted and the seller paid', async () => {
    verifyPaid.mockResolvedValue({ amountCents: 500, paymentRef: 'pi_1', metadata: { cloneId: '9' } });
    const { db, inserts } = fakeDb(listed, { id: 77, status: 'active' });
    const out = await completeVoiceCheckout(db, env, { tenantId: 2, buyerUserId: 'b', checkoutSessionId: 'cs_1' });
    expect(inserts[0]).toMatchObject({ tenantId: 2, cloneId: 9, status: 'active' });
    expect(out).toMatchObject({ licenseId: 77, priceCents: 500, commissionCents: 75, sellerCents: 425 });
    expect(split.mock.calls[0]![1]).toMatchObject({ sellerTenantId: 1, sellerRef: 'seller', saleId: 77, referencePrefix: 'voice' });
  });

  it('refuses an underpaid session', async () => {
    verifyPaid.mockResolvedValue({ amountCents: 100, paymentRef: 'pi_1', metadata: { cloneId: '9' } });
    await expect(completeVoiceCheckout(fakeDb(listed, undefined).db, env, { tenantId: 2, buyerUserId: 'b', checkoutSessionId: 'cs_1' }))
      .rejects.toThrow(/does not cover/);
  });

  it('splits what was actually charged, not the current list price', async () => {
    verifyPaid.mockResolvedValue({ amountCents: 700, paymentRef: 'pi_1', metadata: { cloneId: '9' } });
    const out = await completeVoiceCheckout(fakeDb(listed, { id: 77, status: 'active' }).db, env, { tenantId: 2, buyerUserId: 'b', checkoutSessionId: 'cs_1' });
    expect(out).toMatchObject({ applied: true, priceCents: 700, commissionCents: 105, sellerCents: 595 });
    expect(split.mock.calls[0]![1]).toMatchObject({ commissionCents: 105, sellerCents: 595 });
  });

  it('a late checkout after a refund does not re-grant and never claims a purchase', async () => {
    verifyPaid.mockResolvedValue({ amountCents: 500, paymentRef: 'pi_1', metadata: { cloneId: '9' } });
    const { db, inserts } = fakeDb(listed, { id: 77, status: 'revoked' });
    const out = await completeVoiceCheckout(db, env, { tenantId: 2, buyerUserId: 'b', checkoutSessionId: 'cs_1' });
    expect(out).toEqual({ applied: false, reason: 'license_revoked' });
    expect(split).not.toHaveBeenCalled();
    // The only write is the do-nothing insert; the revoked row is never updated to active.
    expect(inserts).toHaveLength(1);
  });

  it('refuses checkout when a revoked license row exists, or the clone has no owner', async () => {
    await expect(startVoiceCheckout(fakeDb(listed, { id: 3, status: 'revoked' }).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9 }))
      .rejects.toThrow(/own/);
    await expect(startVoiceCheckout(fakeDb({ ...listed, userId: null }, undefined).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9 }))
      .rejects.toThrow(/no owner/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('keys the processor idempotency on buyer and price, and refuses a foreign returnUrl', async () => {
    createSession.mockResolvedValue({ checkoutUrl: 'https://pay.example/s' });
    await startVoiceCheckout(fakeDb(listed, undefined).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9 });
    expect(createSession.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: 'voice-checkout:9:2:b:500',
      successUrl: 'https://app.test/marketplace/voices?checkout={CHECKOUT_SESSION_ID}&voice=9',
    });
    await expect(startVoiceCheckout(fakeDb(listed, undefined).db, env, { tenantId: 2, buyerUserId: 'b', cloneId: 9, returnUrl: 'https://evil.example/x' }))
      .rejects.toThrow(/allowed origin/);
  });
});

describe('voice purchase reversal (refund / dispute)', () => {
  const sale = { tenantId: 1, accountKind: 'user', accountRef: 'seller', denomination: 'usd_cents', amount: '425.000000', reference: 'voice-sale:77', memo: 'Voice sale — Alice' };
  const fee = { tenantId: 1, accountKind: 'partner', accountRef: 'platform', denomination: 'usd_cents', amount: '75.000000', reference: 'voice-fee:77', memo: 'Platform fee — Alice' };

  function reversalDb(initial: string | null, ledger: Array<Record<string, unknown>>) {
    let status = initial;
    const licenseWrites: unknown[] = [];
    const ledgerWrites: Array<Array<Record<string, unknown>>> = [];
    const db = {
      select: () => {
        let isLicense = false;
        const chain: Record<string, unknown> = {};
        chain.from = (t: object) => { isLicense = 'cloneId' in t; return chain; };
        chain.where = () => chain;
        chain.limit = () => Promise.resolve(status ? [{ status }] : []);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(isLicense ? [] : ledger).then(res);
        return chain;
      },
      insert: (t: object) => {
        if ('cloneId' in t) {
          return {
            values: (v: unknown) => ({
              onConflictDoUpdate: () => ({ returning: () => { licenseWrites.push(v); status = 'revoked'; return Promise.resolve([{ id: 77 }]); } }),
            }),
          };
        }
        return { values: (v: Array<Record<string, unknown>>) => ({ onConflictDoNothing: () => { ledgerWrites.push(v); return Promise.resolve(); } }) };
      },
    };
    return { db: db as never, licenseWrites, ledgerWrites };
  }

  it('revokes the license and writes keyed negative ledger reversals', async () => {
    const { db, ledgerWrites } = reversalDb('active', [sale, fee]);
    const out = await reverseVoicePurchase(db, env, { tenantId: 2, cloneId: 9 });
    expect(out).toEqual({ reversed: true, licenseId: 77 });
    expect(ledgerWrites[0]!.map((e) => [e.reference, e.amount, e.accountKind, e.tenantId])).toEqual([
      ['voice-sale-reversal:77', '-425', 'user', 1],
      ['voice-fee-reversal:77', '-75', 'partner', 1],
    ]);
  });

  it('replaying the event is a no-op (same unique references, reversed:false)', async () => {
    const { db, ledgerWrites } = reversalDb('active', [sale, fee]);
    await reverseVoicePurchase(db, env, { tenantId: 2, cloneId: 9 });
    const again = await reverseVoicePurchase(db, env, { tenantId: 2, cloneId: 9 });
    expect(again.reversed).toBe(false);
    expect(ledgerWrites[1]!.map((e) => e.reference)).toEqual(ledgerWrites[0]!.map((e) => e.reference));
  });

  it('a refund that beats the checkout leaves a revoked tombstone and no ledger lines', async () => {
    const { db, licenseWrites, ledgerWrites } = reversalDb(null, []);
    const out = await reverseVoicePurchase(db, env, { tenantId: 2, cloneId: 9 });
    expect(out.reversed).toBe(true);
    expect(licenseWrites[0]).toMatchObject({ tenantId: 2, cloneId: 9, status: 'revoked' });
    expect(ledgerWrites).toHaveLength(0);
  });
});
