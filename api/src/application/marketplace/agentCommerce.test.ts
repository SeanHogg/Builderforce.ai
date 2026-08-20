/**
 * A PRICED AGENT NOBODY WAS EVER CHARGED FOR.
 *
 * `ide_agents.price_cents` shipped with the marketplace and `POST
 * /agents/:id/hire` never read it: an owner could list an agent at $99 and every
 * hire was free, forever, silently. These tests pin the behaviour that replaced
 * that — the refusals that would otherwise each become a charge for something the
 * buyer already has, cannot use, or published themselves; the entitlement the
 * hire gate reads; and the split, because it is money.
 *
 * The commission assertions matter twice over here: an agent seller is credited
 * as a WORKSPACE rather than as a person (`ide_agents` names no author), so the
 * account the money lands in and the account the lifetime threshold is measured
 * against have to be the same one. If they diverge, every agent seller sits under
 * the threshold forever and the platform's cut is quietly zero.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import {
  completeAgentCheckout,
  holdsAgentPurchase,
  startAgentCheckout,
  AGENT_PURCHASE_KIND,
} from './agentCommerce';

const createOneTimeCheckoutSession = vi.fn();
const retrieveCheckoutSession = vi.fn();

vi.mock('../../infrastructure/payment', () => ({
  buildPaymentProvider: () => ({ createOneTimeCheckoutSession, retrieveCheckoutSession }),
}));

const env = { STRIPE_SECRET_KEY: 'sk_test_x' } as unknown as Env;
const BUYER = { tenantId: 42, buyerUserId: 'u-buyer' };

/** The seller's workspace. Its ledger is where an agent sale has to land. */
const SELLER_TENANT = 7;

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  name: 'Release Captain',
  tenantId: SELLER_TENANT,
  priceCents: 5_000,
  ...over,
});

type FakeArg = ReturnType<typeof fakeDb>;

/**
 * The bound LITERALS a Drizzle `where` clause carries.
 *
 * `whereColumns` answers "which columns does this filter on", which is the usual
 * question. Here the question is "which VALUE does it compare them to", because
 * the bug being guarded against — reading the 'user' ledger account while
 * crediting the 'tenant' one — filters on exactly the right columns and still
 * returns nothing. Cycle-guarded and depth-bounded for the same reason
 * `whereColumns` is: a Drizzle column holds a back reference to its table.
 */
function whereLiterals(where: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (node == null || depth > 10) return;
    if (typeof node === 'string' || typeof node === 'number') { found.add(String(node)); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    // Skip the table back reference — it drags the whole schema in.
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'table') continue;
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else walk(value, depth + 1);
    }
  };
  walk(where, 0);
  return [...found];
}

const start = (db: FakeArg, over: Record<string, unknown> = {}) =>
  startAgentCheckout(db as unknown as Db, env, {
    ...BUYER,
    agentId: 'agent-1',
    returnUrl: 'https://app.example.com/workforce',
    ...over,
  });

beforeEach(() => {
  createOneTimeCheckoutSession.mockReset();
  retrieveCheckoutSession.mockReset();
  createOneTimeCheckoutSession.mockResolvedValue({ sessionId: 'cs_1', checkoutUrl: 'https://pay.example/cs_1' });
});

describe('startAgentCheckout — what it refuses to sell', () => {
  it('refuses an agent that is not on the public market', async () => {
    await expect(start(fakeDb([[]]))).rejects.toMatchObject({ message: 'Agent not found', status: 404 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  // THE FREE PATH. A zero-priced agent has no checkout at all: the hire route
  // never sends the buyer here, and if something does, taking $0.00 through a
  // processor is refused rather than recorded as a purchase.
  it('refuses to take money for a free agent', async () => {
    await expect(start(fakeDb([[agent({ priceCents: 0 })]])))
      .rejects.toMatchObject({ status: 400 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to sell a workspace what it published itself', async () => {
    await expect(start(fakeDb([[agent({ tenantId: BUYER.tenantId })]])))
      .rejects.toMatchObject({ message: 'You already own what you published' });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to charge twice for something already bought', async () => {
    // agent lookup, then the purchase lookup finds a row.
    await expect(start(fakeDb([[agent()], [{ id: 9 }]])))
      .rejects.toMatchObject({ message: 'You already own this' });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses when payments are not configured, rather than granting for free', async () => {
    await expect(
      startAgentCheckout(fakeDb([[agent()], []]) as unknown as Db, {} as unknown as Env, {
        ...BUYER, agentId: 'agent-1', returnUrl: 'https://app.example.com/workforce',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(createOneTimeCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('startAgentCheckout — the session it mints', () => {
  it('names this flow and this buyer, so the return leg can be verified', async () => {
    const result = await start(fakeDb([[agent()], []]));
    expect(result).toEqual({ checkoutUrl: 'https://pay.example/cs_1' });

    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.amountCents).toBe(5_000);
    expect(opts.metadata).toMatchObject({
      purchaseKind: AGENT_PURCHASE_KIND,
      agentId: 'agent-1',
      buyerTenantId: '42',
    });
    // Same agent, same buyer, same key — a double-clicked button is one session.
    expect(opts.idempotencyKey).toBe('wf-checkout:agent-1:42');
    // The processor substitutes the id, so what comes back is a value it minted.
    expect(opts.successUrl).toContain('{CHECKOUT_SESSION_ID}');
  });

  it('keeps only the origin and path of the caller’s return url', async () => {
    await start(fakeDb([[agent()], []]), { returnUrl: 'https://app.example.com/workforce?evil=1#x' });
    const opts = createOneTimeCheckoutSession.mock.calls[0]![0];
    expect(opts.successUrl).toBe('https://app.example.com/workforce?checkout={CHECKOUT_SESSION_ID}&agent=agent-1');
    expect(opts.cancelUrl).toBe('https://app.example.com/workforce?checkout=cancelled');
  });
});

const paidSession = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1',
  paymentStatus: 'paid',
  amountTotalCents: 5_000,
  currency: 'USD',
  paymentIntentId: 'pi_1',
  subscriptionId: null,
  customerEmail: 'buyer@example.com',
  metadata: { purchaseKind: AGENT_PURCHASE_KIND, agentId: 'agent-1', buyerTenantId: '42' },
  ...over,
});

const complete = (db: FakeArg) =>
  completeAgentCheckout(db as unknown as Db, env, { ...BUYER, checkoutSessionId: 'cs_1' });

/** agent lookup → purchase insert → lifetime-earnings sum → ledger insert. */
const settleQueue = (earnings: string) =>
  fakeDb([[agent()], [{ id: 9 }], [{ total: earnings, sales: '0' }], []]);

describe('completeAgentCheckout', () => {
  it('refuses a session raised for a different workspace', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      paidSession({ metadata: { purchaseKind: AGENT_PURCHASE_KIND, agentId: 'agent-1', buyerTenantId: '99' } }),
    );
    await expect(complete(fakeDb([]))).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a session raised for some other kind of purchase', async () => {
    retrieveCheckoutSession.mockResolvedValue(
      paidSession({ metadata: { purchaseKind: 'knowledge_listing', agentId: 'agent-1', buyerTenantId: '42' } }),
    );
    await expect(complete(fakeDb([]))).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a payment that no longer covers a raised price', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession({ amountTotalCents: 4_000 }));
    await expect(complete(fakeDb([[agent({ priceCents: 9_000 })]])))
      .rejects.toMatchObject({ message: 'The payment does not cover this agent' });
  });

  it('records the purchase against the buyer’s workspace with the processor’s own reference', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = settleQueue('0');
    const result = await complete(db);

    expect(result).toMatchObject({ purchaseId: 9, agentId: 'agent-1', priceCents: 5_000 });
    const insert = db.calls.find((call) => call.kind === 'insert');
    // artifactType 'agent' is the whole reason this row can live in
    // marketplace_purchases at all — migration 0982 admitted the value.
    expect(insert?.payload).toMatchObject({
      userId: 'u-buyer',
      tenantId: 42,
      artifactType: 'agent',
      artifactSlug: 'agent-1',
      priceCents: 5_000,
      provider: 'stripe',
      externalRef: 'pi_1',
    });
  });

  it('takes NOTHING from a seller who is under the lifetime threshold', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const result = await complete(settleQueue('0'));
    expect(result.commissionCents).toBe(0);
    expect(result.sellerCents).toBe(5_000);
  });

  it('takes the platform rate once the seller is past the threshold', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    // Lifetime earnings above the $200,000 default threshold.
    const result = await complete(settleQueue('25000000'));
    expect(result.commissionCents).toBe(750); // 15% of $50.00
    expect(result.sellerCents).toBe(4_250);
  });

  it('credits the SELLER’s workspace, not the buyer’s — the earning must be payable', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = settleQueue('25000000');
    await complete(db);

    const ledger = db.calls.filter((call) => call.kind === 'insert').at(-1);
    const rows = ledger?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tenantId: SELLER_TENANT,
      accountKind: 'tenant',
      accountRef: `tenant:${SELLER_TENANT}`,
      amount: '4250',
      reference: 'wf-sale:9',
    });
    expect(rows[1]).toMatchObject({
      tenantId: SELLER_TENANT,
      accountKind: 'partner',
      accountRef: 'platform',
      amount: '750',
      reference: 'wf-fee:9',
    });
  });

  it('measures the threshold against the SAME account it credits', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    const db = settleQueue('25000000');
    await complete(db);
    // The lifetime SUM is the third statement; if it read the default 'user'
    // account it would never see a tenant-credited agent sale, and every agent
    // seller would sit under the threshold forever at 0% commission.
    const earningsRead = db.calls.filter((call) => call.kind === 'select').at(-1);
    expect(whereColumns(earningsRead?.where)).toEqual(
      expect.arrayContaining(['tenant_id', 'account_kind', 'account_ref']),
    );
    // The account it FILTERS on must be the account it CREDITS. Reading the
    // bound literals is the only way to see that from the outside, and it is
    // worth seeing: 'user' here (the default) would silently zero every fee.
    expect(whereLiterals(earningsRead?.where)).toContain('tenant');
    expect(whereLiterals(earningsRead?.where)).toContain(`tenant:${SELLER_TENANT}`);
  });

  it('survives a replayed redirect: the conflicting insert returns nothing and the row is re-read', async () => {
    retrieveCheckoutSession.mockResolvedValue(paidSession());
    // agent → insert conflicts (no row) → re-read finds it → earnings → ledger
    const db = fakeDb([[agent()], [], [{ id: 4 }], [{ total: '0', sales: '0' }], []]);
    await expect(complete(db)).resolves.toMatchObject({ purchaseId: 4 });
    // The SECOND settlement writes no second charge: the same purchase id comes
    // back, so the ledger references collide on the unique index rather than
    // paying the seller twice.
    const ledger = db.calls.filter((call) => call.kind === 'insert').at(-1);
    const rows = ledger?.payload as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ reference: 'wf-sale:4' });
  });
});

describe('holdsAgentPurchase — the gate POST /hire reads', () => {
  it('is true only when a row exists for THIS workspace', async () => {
    await expect(holdsAgentPurchase(fakeDb([[{ id: 1 }]]) as unknown as Db, 42, 'agent-1')).resolves.toBe(true);
    await expect(holdsAgentPurchase(fakeDb([[]]) as unknown as Db, 42, 'agent-1')).resolves.toBe(false);
  });

  it('asks about the PURCHASE, not the hire — an unhired agent is still bought', async () => {
    const db = fakeDb([[{ id: 1 }]]);
    await holdsAgentPurchase(db as unknown as Db, 42, 'agent-1');
    const columns = whereColumns(db.calls[0]?.where);
    // `agent_purchases.unhired_at` must play no part here: unhiring releases the
    // agent, it does not refund it, so re-hiring must not trigger a second charge.
    expect(columns).not.toContain('unhired_at');
    expect(columns).toEqual(expect.arrayContaining(['tenant_id', 'artifact_type', 'artifact_slug']));
  });
});
