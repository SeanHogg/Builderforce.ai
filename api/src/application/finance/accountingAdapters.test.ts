/**
 * The five adapters, against RECORDED PAYLOADS.
 *
 * ── WHAT THIS FILE IS ACTUALLY FOR ─────────────────────────────────────────────
 * One assertion class matters more than everything else here: the SIGN. An adapter
 * that leaks its vendor's convention does not produce a missing number, it produces
 * a confident backwards one — `financeRollup` divides cash by net burn, and a burn
 * that came out negative reads as a profitable company with infinite runway on a
 * founder's board.
 *
 * The payloads below are the vendors' documented response shapes with the fields
 * each adapter reads. They are not a substitute for a sandbox — no credential for
 * any of the five exists in this environment, so what is verified here is that the
 * adapter does what the vendor's DOCUMENTATION says it should, not that the
 * documentation is right. That distinction is stated in the port and is the one
 * thing about this work still open.
 *
 * The last test in the file is the one worth reading first: the same £250 supplier
 * payment, expressed the way each of the five vendors expresses it, must come out
 * of all five as −250.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNTING_ADAPTERS,
  AccountingProviderError,
  documentStatus,
  netsuiteAuthHeader,
  oauthEncode,
  parseXeroDate,
  plaidHost,
  plaidTransaction,
  type AccountingCredential,
} from './accountingAdapters';

/* ── a fetch that answers from a queue and records what it was asked ─────────── */

interface RecordedCall { url: string; init: RequestInit }

const calls: RecordedCall[] = [];
const queued: Array<{ body: unknown; ok: boolean; status: number }> = [];

function reply(body: unknown, ok = true, status = 200): void {
  queued.push({ body, ok, status });
}

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = queued.shift() ?? { body: {}, ok: true, status: 200 };
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as unknown as Response;
  }));
}

afterEach(() => {
  calls.length = 0;
  queued.length = 0;
  vi.unstubAllGlobals();
});

const WINDOW = { fromISO: '2026-07-01T00:00:00.000Z', toISO: '2026-07-31T00:00:00.000Z' };

const qboCredential: AccountingCredential = { accessToken: 'tok', externalAccountId: '4620816365' };
const xeroCredential: AccountingCredential = { accessToken: 'tok', externalAccountId: 'xero-tenant-1' };
const netsuiteCredential: AccountingCredential = {
  fields: {
    accountId: '1234567_SB1',
    consumerKey: 'ck', consumerSecret: 'cs', tokenId: 'ti', tokenSecret: 'ts',
  },
};
const plaidCredential: AccountingCredential = {
  accessToken: 'access-sandbox-1',
  fields: { clientId: 'cid', secret: 'sec', environment: 'sandbox' },
};
const stripeCredential: AccountingCredential = { accessToken: 'sk_test', externalAccountId: 'acct_1' };

/* ══ QuickBooks ═════════════════════════════════════════════════════════════ */

describe('QuickBooks Online', () => {
  it('NEGATES a Purchase — QuickBooks reports spend as a positive total', async () => {
    stubFetch();
    reply({
      QueryResponse: {
        Purchase: [{
          Id: '184', TxnDate: '2026-07-14', TotalAmt: 250.0,
          PrivateNote: 'Office rent', PaymentType: 'Check',
          EntityRef: { value: '56', name: 'Northside Property' },
          AccountRef: { value: '35', name: 'Checking' },
          CurrencyRef: { value: 'USD' },
          Line: [{ Amount: 250, DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { name: 'Rent' } } }],
        }],
        startPosition: 1, maxResults: 100,
      },
    });

    const page = await ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, WINDOW);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.amount).toBe(-250);
    expect(page.items[0]!.category).toBe('Rent');
    expect(page.items[0]!.counterparty).toBe('Northside Property');
    expect(page.items[0]!.occurredAtISO).toBe('2026-07-14T00:00:00.000Z');
  });

  it('keeps a CREDITED purchase positive — that is the refund of a spend, not a spend', async () => {
    stubFetch();
    reply({ QueryResponse: { Purchase: [{ Id: '9', TxnDate: '2026-07-02', TotalAmt: 250, Credit: true }] } });
    const page = await ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, WINDOW);
    expect(page.items[0]!.amount).toBe(250);
  });

  it('sends the realm id and the pinned minor version, and rolls the cursor onto Deposits', async () => {
    stubFetch();
    reply({ QueryResponse: { Purchase: [] } });
    const page = await ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, WINDOW);
    expect(calls[0]!.url).toContain('/v3/company/4620816365/query');
    expect(calls[0]!.url).toContain('minorversion=70');
    // A short page means Purchases are exhausted — the walk moves to the OTHER
    // entity rather than stopping, or the feed would be burn with no revenue.
    expect(page.cursor).toBe('Deposit:1');
  });

  it('reads a Deposit as money IN', async () => {
    stubFetch();
    reply({ QueryResponse: { Deposit: [{ Id: '77', TxnDate: '2026-07-09', TotalAmt: 900 }] } });
    const page = await ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, { ...WINDOW, cursor: 'Deposit:1' });
    expect(page.items[0]!.amount).toBe(900);
    // Deposits are the last entity, so an exhausted page ends the walk.
    expect(page.cursor).toBeUndefined();
  });

  it('makes a Bill a POSITIVE payable — the direction carries the sign, never the amount', async () => {
    stubFetch();
    reply({
      QueryResponse: {
        Bill: [{
          Id: '31', DocNumber: 'B-31', TxnDate: '2026-07-03', DueDate: '2026-08-03',
          TotalAmt: 250, Balance: 250, VendorRef: { name: 'Northside Property' },
          Line: [{ Amount: 250, Description: 'July rent' }],
        }],
      },
    });
    const page = await ACCOUNTING_ADAPTERS.quickbooks.fetchDocuments!(qboCredential, { ...WINDOW, cursor: 'Bill:1' });
    expect(page.items[0]!.direction).toBe('payable');
    expect(page.items[0]!.amount).toBe(250);
    expect(page.items[0]!.paidAmount).toBe(0);
  });

  it('negates a credit-card balance — money owed is not money held', async () => {
    stubFetch();
    reply({
      QueryResponse: {
        Account: [
          { Id: '35', Name: 'Checking', AccountType: 'Bank', CurrentBalance: 51_204.18, CurrencyRef: { value: 'USD' } },
          { Id: '41', Name: 'Amex', AccountType: 'Credit Card', CurrentBalance: 9_320.5, CurrencyRef: { value: 'USD' } },
        ],
      },
    });
    const balances = await ACCOUNTING_ADAPTERS.quickbooks.fetchBalances!(qboCredential);
    expect(balances.map((b) => [b.accountKind, b.balance])).toEqual([['bank', 51_204.18], ['credit', -9_320.5]]);
  });

  it('turns a vendor failure into a typed error rather than an empty page', async () => {
    stubFetch();
    reply({ Fault: 'nope' }, false, 401);
    await expect(ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, WINDOW))
      .rejects.toBeInstanceOf(AccountingProviderError);
  });

  it('refuses a connection with no realm id instead of querying somebody else\'s book', async () => {
    stubFetch();
    await expect(ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!({ accessToken: 'tok' }, WINDOW))
      .rejects.toThrow(/company \(realm\) id/);
    expect(calls).toHaveLength(0);
  });
});

/* ══ Xero ═══════════════════════════════════════════════════════════════════ */

describe('Xero', () => {
  it('takes the sign from the TYPE, because Xero reports every total unsigned', async () => {
    stubFetch();
    reply({
      BankTransactions: [
        { BankTransactionID: 'a', Type: 'SPEND', Total: 250, Date: '/Date(1783036800000+0000)/', Status: 'AUTHORISED', Contact: { Name: 'Northside Property' }, CurrencyCode: 'USD' },
        { BankTransactionID: 'b', Type: 'RECEIVE', Total: 900, Date: '/Date(1783036800000+0000)/', Status: 'AUTHORISED', CurrencyCode: 'USD' },
        { BankTransactionID: 'c', Type: 'SPEND-PREPAYMENT', Total: 40, Date: '/Date(1783036800000+0000)/', Status: 'AUTHORISED', CurrencyCode: 'USD' },
      ],
    });
    const page = await ACCOUNTING_ADAPTERS.xero.fetchTransactions!(xeroCredential, WINDOW);
    expect(page.items.map((item) => item.amount)).toEqual([-250, 900, -40]);
  });

  it('treats an unknown SPEND variant as an OUTFLOW — the safe half of a guess', async () => {
    stubFetch();
    reply({ BankTransactions: [{ BankTransactionID: 'z', Type: 'SPEND-SOMETHING-NEW', Total: 75, Status: 'AUTHORISED' }] });
    const page = await ACCOUNTING_ADAPTERS.xero.fetchTransactions!(xeroCredential, WINDOW);
    // Anything not prefixed RECEIVE is money out. The alternative — defaulting an
    // unrecognised type to positive — would add a cost to revenue.
    expect(page.items[0]!.amount).toBe(-75);
  });

  it('marks anything not AUTHORISED as pending, so it cannot reach a runway', async () => {
    stubFetch();
    reply({ BankTransactions: [{ BankTransactionID: 'd', Type: 'SPEND', Total: 10, Status: 'DELETED' }] });
    const page = await ACCOUNTING_ADAPTERS.xero.fetchTransactions!(xeroCredential, WINDOW);
    expect(page.items[0]!.status).toBe('pending');
  });

  it('sends Xero-Tenant-Id — one grant reaches several organisations and the token says nothing', async () => {
    stubFetch();
    reply({ BankTransactions: [] });
    await ACCOUNTING_ADAPTERS.xero.fetchTransactions!(xeroCredential, WINDOW);
    expect((calls[0]!.init.headers as Record<string, string>)['Xero-Tenant-Id']).toBe('xero-tenant-1');
    // Xero's `where` grammar takes DateTime literals; a quoted date matches nothing.
    expect(decodeURIComponent(calls[0]!.url)).toContain('Date>=DateTime(2026,7,1)');
  });

  it('makes an ACCPAY invoice a POSITIVE payable, exactly as a QuickBooks Bill is', async () => {
    stubFetch();
    reply({
      Invoices: [
        { InvoiceID: 'i1', InvoiceNumber: 'BILL-9', Type: 'ACCPAY', Total: 250, AmountPaid: 0, Status: 'AUTHORISED', Contact: { Name: 'Northside Property' }, Date: '/Date(1783036800000+0000)/' },
        { InvoiceID: 'i2', InvoiceNumber: 'INV-4', Type: 'ACCREC', Total: 1_200, AmountPaid: 400, Status: 'AUTHORISED', Contact: { Name: 'Acme' } },
      ],
    });
    const page = await ACCOUNTING_ADAPTERS.xero.fetchDocuments!(xeroCredential, WINDOW);
    expect(page.items[0]!.direction).toBe('payable');
    expect(page.items[0]!.amount).toBe(250);
    expect(page.items[1]!.direction).toBe('receivable');
    expect(page.items[1]!.status).toBe('part-paid');
  });

  it('reads the closing balance out of the Bank Summary report', async () => {
    stubFetch();
    reply({
      Reports: [{
        Rows: [
          { RowType: 'Header', Cells: [] },
          {
            RowType: 'Section',
            Rows: [{
              RowType: 'Row',
              Cells: [
                { Value: 'Business Current', Attributes: [{ Id: 'account', Value: 'acc-1' }] },
                { Value: '10000.00' }, { Value: '5000.00' }, { Value: '2000.00' }, { Value: '13000.00' },
              ],
            }],
          },
        ],
      }],
    });
    const balances = await ACCOUNTING_ADAPTERS.xero.fetchBalances!(xeroCredential);
    // Cells are [account, opening, received, spent, CLOSING] — the fifth, not the second.
    expect(balances).toEqual([expect.objectContaining({ accountId: 'acc-1', accountKind: 'bank', balance: 13_000 })]);
  });
});

describe('parseXeroDate', () => {
  it('parses the .NET date format Date.parse returns NaN for', () => {
    // An adapter that forgot this would stamp every transaction at the epoch and put
    // a decade of a company's burn into January 1970.
    expect(parseXeroDate('/Date(1518685950940+0000)/')).toBe('2018-02-15T09:12:30.940Z');
    expect(parseXeroDate('2026-07-14')).toBe('2026-07-14T00:00:00.000Z');
    expect(parseXeroDate('')).toBeNull();
    expect(parseXeroDate('not a date')).toBeNull();
  });
});

/* ══ NetSuite ═══════════════════════════════════════════════════════════════ */

describe('NetSuite', () => {
  it('takes the sign from the transaction TYPE, and DROPS a type it does not know', async () => {
    stubFetch();
    reply({
      items: [
        { id: '1', type: 'VendBill', trandate: '2026-07-14', foreigntotal: 250, entityname: 'Northside Property', currencyname: 'USD' },
        { id: '2', type: 'CustPymt', trandate: '2026-07-15', foreigntotal: 900, currencyname: 'USD' },
        // A journal entry is not cash. Guessing its direction would move a burn
        // figure by a number nobody chose, so it is skipped.
        { id: '3', type: 'Journal', trandate: '2026-07-16', foreigntotal: 5_000 },
      ],
    });
    const page = await ACCOUNTING_ADAPTERS.netsuite.fetchTransactions!(netsuiteCredential, WINDOW);
    expect(page.items.map((item) => [item.id, item.amount])).toEqual([['1', -250], ['2', 900]]);
  });

  it('signs with OAuth 1.0a TBA and targets the account-derived host', async () => {
    stubFetch();
    reply({ items: [] });
    await ACCOUNTING_ADAPTERS.netsuite.fetchTransactions!(netsuiteCredential, WINDOW);
    // `1234567_SB1` → `1234567-sb1…`. The raw account id resolves to nothing at all.
    expect(calls[0]!.url).toContain('https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^OAuth /);
    expect(headers.Authorization).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(headers.Authorization).toContain('realm="1234567_SB1"');
    // Without `Prefer: transient` NetSuite rejects the query outright.
    expect(headers.Prefer).toBe('transient');
  });

  it('refuses a half-configured token pair rather than sending an unsignable request', async () => {
    stubFetch();
    await expect(ACCOUNTING_ADAPTERS.netsuite.fetchTransactions!(
      { fields: { accountId: '1', consumerKey: 'k' } }, WINDOW,
    )).rejects.toThrow(/consumerSecret/);
    expect(calls).toHaveLength(0);
  });

  it('separates a customer invoice from a vendor bill by direction, both positive', async () => {
    stubFetch();
    reply({
      items: [
        { id: '10', type: 'CustInvc', tranid: 'INV-10', trandate: '2026-07-01', duedate: '2999-08-01', foreigntotal: 1_200, foreignamountunpaid: 1_200, entityname: 'Acme' },
        { id: '11', type: 'VendBill', tranid: 'B-11', trandate: '2026-07-02', foreigntotal: 250, foreignamountunpaid: 0, entityname: 'Northside Property' },
      ],
    });
    const page = await ACCOUNTING_ADAPTERS.netsuite.fetchDocuments!(netsuiteCredential, WINDOW);
    expect(page.items.map((item) => [item.direction, item.amount, item.status]))
      .toEqual([['receivable', 1_200, 'open'], ['payable', 250, 'paid']]);
  });
});

describe('the OAuth 1.0a signature', () => {
  it('percent-encodes the characters encodeURIComponent leaves alone', () => {
    // `!*'()` unencoded is the single most common reason a hand-rolled OAuth 1.0a
    // signature is rejected, with no useful message to say why.
    expect(oauthEncode("a!b*c'd(e)f")).toBe('a%21b%2Ac%27d%28e%29f');
    expect(oauthEncode('a b')).toBe('a%20b');
  });

  it('is deterministic for a fixed nonce and timestamp', async () => {
    const fields = { accountId: 'ACCT', consumerKey: 'ck', consumerSecret: 'cs', tokenId: 'ti', tokenSecret: 'ts' };
    const url = 'https://acct.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=100&offset=0';
    const first = await netsuiteAuthHeader(fields, 'POST', url, 'nonce123', 1_700_000_000);
    const second = await netsuiteAuthHeader(fields, 'POST', url, 'nonce123', 1_700_000_000);
    expect(first).toBe(second);
    expect(first).toContain('oauth_nonce="nonce123"');
    expect(first).toContain('oauth_timestamp="1700000000"');
  });

  it('changes when the query string does — the query is part of what is signed', async () => {
    const fields = { accountId: 'ACCT', consumerKey: 'ck', consumerSecret: 'cs', tokenId: 'ti', tokenSecret: 'ts' };
    const base = 'https://acct.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
    const a = await netsuiteAuthHeader(fields, 'POST', `${base}?limit=100&offset=0`, 'n', 1);
    const b = await netsuiteAuthHeader(fields, 'POST', `${base}?limit=100&offset=100`, 'n', 1);
    expect(a).not.toBe(b);
  });
});

/* ══ Plaid ══════════════════════════════════════════════════════════════════ */

describe('Plaid', () => {
  it('NEGATES every amount — Plaid signs from the account, we sign from the company', () => {
    // A POSITIVE Plaid amount is money that LEFT the account. This is the single
    // conversion in the whole port most likely to be got backwards.
    expect(plaidTransaction({ transaction_id: 't', date: '2026-07-14', amount: 12.34 }).amount).toBe(-12.34);
    expect(plaidTransaction({ transaction_id: 't', date: '2026-07-14', amount: -500 }).amount).toBe(500);
  });

  it('carries pending through, because a hold can still vanish', () => {
    expect(plaidTransaction({ transaction_id: 't', amount: 5, pending: true }).status).toBe('pending');
    expect(plaidTransaction({ transaction_id: 't', amount: 5, pending: false }).status).toBe('posted');
  });

  it('REPLAYS REMOVALS — a removal that is dropped leaves a ghost expense in the burn', async () => {
    stubFetch();
    reply({
      added: [{ transaction_id: 'a1', date: '2026-07-14', amount: 250, iso_currency_code: 'USD', name: 'Rent', account_id: 'acc-1' }],
      modified: [{ transaction_id: 'a2', date: '2026-07-15', amount: -900, iso_currency_code: 'USD', name: 'Customer payment' }],
      removed: [{ transaction_id: 'gone-1' }, { transaction_id: 'gone-2' }],
      next_cursor: 'cursor-2',
      has_more: false,
    });
    const page = await ACCOUNTING_ADAPTERS.plaid.fetchTransactions!(plaidCredential, WINDOW);
    expect(page.items.map((item) => item.amount)).toEqual([-250, 900]);
    expect(page.removedIds).toEqual(['gone-1', 'gone-2']);
    // No `cursor` because there is no more to read…
    expect(page.cursor).toBeUndefined();
    // …but the CHECKPOINT is still returned, because it is where tomorrow starts.
    // Storing it only while `has_more` would re-read the entire item every night.
    expect(page.checkpoint).toBe('cursor-2');
  });

  it('asks again while Plaid says there is more', async () => {
    stubFetch();
    reply({ added: [], next_cursor: 'c2', has_more: true });
    const page = await ACCOUNTING_ADAPTERS.plaid.fetchTransactions!(plaidCredential, WINDOW);
    expect(page.cursor).toBe('c2');
    expect(page.checkpoint).toBe('c2');
  });

  it('omits the cursor entirely on a first call rather than sending an empty one', async () => {
    stubFetch();
    reply({ added: [] });
    await ACCOUNTING_ADAPTERS.plaid.fetchTransactions!(plaidCredential, WINDOW);
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect('cursor' in body).toBe(false);
    // Plaid authenticates in the BODY, not a header — the one vendor of the five.
    expect(body.client_id).toBe('cid');
    expect(body.access_token).toBe('access-sandbox-1');
  });

  it('negates a credit balance so a card debt cannot read as spendable cash', async () => {
    stubFetch();
    reply({
      accounts: [
        { account_id: 'd1', name: 'Checking', type: 'depository', balances: { current: 50_000, iso_currency_code: 'USD' } },
        { account_id: 'c1', name: 'Card', type: 'credit', balances: { current: 10_000, iso_currency_code: 'USD' } },
        { account_id: 'o1', name: 'Brokerage', type: 'investment', balances: { current: 900, iso_currency_code: 'USD' } },
      ],
    });
    const balances = await ACCOUNTING_ADAPTERS.plaid.fetchBalances!(plaidCredential);
    expect(balances.map((b) => [b.accountKind, b.balance]))
      .toEqual([['bank', 50_000], ['credit', -10_000], ['other', 900]]);
    // $50k in the bank and $10k on the card is $40k, not $60k.
    const cash = balances
      .filter((b) => b.accountKind !== 'other')
      .reduce((total, b) => total + b.balance, 0);
    expect(cash).toBe(40_000);
  });

  it('refuses to run when the deployment has no Plaid client credentials', async () => {
    stubFetch();
    await expect(ACCOUNTING_ADAPTERS.plaid.fetchTransactions!({ accessToken: 'x' }, WINDOW))
      .rejects.toThrow(/not configured/);
  });

  it('defaults to PRODUCTION rather than to a sandbox full of invented money', () => {
    expect(plaidHost('sandbox')).toBe('https://sandbox.plaid.com');
    expect(plaidHost(undefined)).toBe('https://production.plaid.com');
    expect(plaidHost('nonsense')).toBe('https://production.plaid.com');
  });

  it('declares no document read at all — a bank feed never sees what was agreed', () => {
    expect(ACCOUNTING_ADAPTERS.plaid.fetchDocuments).toBeUndefined();
  });
});

/* ══ Stripe ═════════════════════════════════════════════════════════════════ */

describe('Stripe (revenue)', () => {
  it('does NOT flip — Stripe already signs from the account, and negating would invert revenue', async () => {
    stubFetch();
    reply({
      data: [
        { id: 'txn_1', created: 1_783_036_800, amount: 200_000, currency: 'usd', type: 'charge', status: 'available', description: 'Subscription' },
        { id: 'txn_2', created: 1_783_036_800, amount: -150_000, currency: 'usd', type: 'refund', status: 'available' },
        { id: 'txn_3', created: 1_783_036_800, amount: -25_000, currency: 'usd', type: 'stripe_fee', status: 'available' },
      ],
      has_more: false,
    });
    const page = await ACCOUNTING_ADAPTERS['stripe-revenue'].fetchTransactions!(stripeCredential, WINDOW);
    expect(page.items.map((item) => item.amount)).toEqual([2_000, -1_500, -250]);
  });

  it('marks subscription-backed money as recurring and one-off money as not', async () => {
    stubFetch();
    reply({
      data: [
        { id: 'a', created: 1, amount: 5_000, currency: 'usd', type: 'charge', status: 'available', source: { id: 'ch_1', invoice: { id: 'in_1', subscription: 'sub_1' } } },
        { id: 'b', created: 1, amount: 5_000, currency: 'usd', type: 'charge', status: 'available', source: { id: 'ch_2', invoice: { id: 'in_2', subscription: null } } },
        { id: 'c', created: 1, amount: 5_000, currency: 'usd', type: 'charge', status: 'available', source: 'ch_3' },
      ],
    });
    const page = await ACCOUNTING_ADAPTERS['stripe-revenue'].fetchTransactions!(stripeCredential, WINDOW);
    // A single sale counted as MRR reports a growth rate that reverses next month.
    expect(page.items.map((item) => item.recurring)).toEqual([true, false, false]);
  });

  it('reads pending money as pending, and pages on the last id', async () => {
    stubFetch();
    reply({
      data: [{ id: 'txn_9', created: 1, amount: 100, currency: 'usd', status: 'pending' }],
      has_more: true,
    });
    const page = await ACCOUNTING_ADAPTERS['stripe-revenue'].fetchTransactions!(stripeCredential, WINDOW);
    expect(page.items[0]!.status).toBe('pending');
    expect(page.cursor).toBe('txn_9');
    expect(calls[0]!.url).toContain('expand%5B%5D=data.source.invoice');
    expect((calls[0]!.init.headers as Record<string, string>)['Stripe-Account']).toBe('acct_1');
  });

  it('issues only receivables — Stripe never bills the company, which is why it declares no bills', async () => {
    stubFetch();
    reply({
      data: [{
        id: 'in_1', number: 'INV-1', customer_name: 'Acme', total: 120_000, amount_paid: 40_000,
        currency: 'usd', created: 1_783_036_800, status: 'open',
        lines: { data: [{ description: 'Seats', quantity: 4, amount: 120_000, price: { unit_amount: 30_000 } }] },
      }],
    });
    const page = await ACCOUNTING_ADAPTERS['stripe-revenue'].fetchDocuments!(stripeCredential, WINDOW);
    expect(page.items[0]!.direction).toBe('receivable');
    expect(page.items[0]!.amount).toBe(1_200);
    expect(page.items[0]!.paidAmount).toBe(400);
    expect(page.items[0]!.status).toBe('part-paid');
    expect(page.items[0]!.lineItems[0]!.unitAmount).toBe(300);
  });

  it('declares no balance read — a Stripe balance is not a company\'s cash position', () => {
    expect(ACCOUNTING_ADAPTERS['stripe-revenue'].fetchBalances).toBeUndefined();
  });
});

/* ══ shared derivations ═════════════════════════════════════════════════════ */

describe('documentStatus', () => {
  it('derives overdue from TODAY rather than trusting a vendor field', () => {
    // No vendor stores "overdue" — it is a fact about now against the due date, and
    // a stored one was true when it was written and has been wrong ever since.
    const now = Date.parse('2026-08-19T00:00:00.000Z');
    expect(documentStatus({ amount: 100, paidAmount: 0, dueAtISO: '2026-08-01T00:00:00.000Z', now })).toBe('overdue');
    expect(documentStatus({ amount: 100, paidAmount: 0, dueAtISO: '2026-09-01T00:00:00.000Z', now })).toBe('open');
    expect(documentStatus({ amount: 100, paidAmount: 40, dueAtISO: '2026-09-01T00:00:00.000Z', now })).toBe('part-paid');
  });

  it('calls a fully-settled document paid even past its due date', () => {
    const now = Date.parse('2026-08-19T00:00:00.000Z');
    expect(documentStatus({ amount: 100, paidAmount: 100, dueAtISO: '2026-08-01T00:00:00.000Z', now })).toBe('paid');
  });

  it('lets void and draft win over everything, in that order', () => {
    expect(documentStatus({ amount: 100, paidAmount: 100, dueAtISO: null, voided: true })).toBe('void');
    expect(documentStatus({ amount: 100, paidAmount: 0, dueAtISO: null, draft: true })).toBe('draft');
  });
});

/* ══ the test the whole port exists for ═════════════════════════════════════ */

describe('ONE payment, five vendors', () => {
  it('comes out of every adapter as −250', async () => {
    // A $250 rent payment to the same landlord, expressed the way each vendor
    // expresses it. If any one of these came back positive, `financeRollup` would
    // subtract a cost from the burn instead of adding it, and the runway on a
    // founder's board would be too long by exactly the amount they had spent.
    const amounts: number[] = [];

    stubFetch();
    reply({ QueryResponse: { Purchase: [{ Id: '1', TxnDate: '2026-07-14', TotalAmt: 250 }] } });
    amounts.push((await ACCOUNTING_ADAPTERS.quickbooks.fetchTransactions!(qboCredential, WINDOW)).items[0]!.amount);

    reply({ BankTransactions: [{ BankTransactionID: '1', Type: 'SPEND', Total: 250, Status: 'AUTHORISED' }] });
    amounts.push((await ACCOUNTING_ADAPTERS.xero.fetchTransactions!(xeroCredential, WINDOW)).items[0]!.amount);

    reply({ items: [{ id: '1', type: 'VendBill', trandate: '2026-07-14', foreigntotal: 250 }] });
    amounts.push((await ACCOUNTING_ADAPTERS.netsuite.fetchTransactions!(netsuiteCredential, WINDOW)).items[0]!.amount);

    reply({ added: [{ transaction_id: '1', date: '2026-07-14', amount: 250 }] });
    amounts.push((await ACCOUNTING_ADAPTERS.plaid.fetchTransactions!(plaidCredential, WINDOW)).items[0]!.amount);

    reply({ data: [{ id: '1', created: 1_783_036_800, amount: -25_000, currency: 'usd', status: 'available' }] });
    amounts.push((await ACCOUNTING_ADAPTERS['stripe-revenue'].fetchTransactions!(stripeCredential, WINDOW)).items[0]!.amount);

    expect(amounts).toEqual([-250, -250, -250, -250, -250]);
  });

  it('reports the same bill as a POSITIVE payable everywhere, sign carried by direction', async () => {
    const documents: Array<[string, number]> = [];

    stubFetch();
    reply({ QueryResponse: { Bill: [{ Id: '1', TxnDate: '2026-07-14', TotalAmt: 250, Balance: 250 }] } });
    const qbo = (await ACCOUNTING_ADAPTERS.quickbooks.fetchDocuments!(qboCredential, { ...WINDOW, cursor: 'Bill:1' })).items[0]!;
    documents.push([qbo.direction, qbo.amount]);

    reply({ Invoices: [{ InvoiceID: '1', Type: 'ACCPAY', Total: 250, AmountPaid: 0, Status: 'AUTHORISED' }] });
    const xero = (await ACCOUNTING_ADAPTERS.xero.fetchDocuments!(xeroCredential, WINDOW)).items[0]!;
    documents.push([xero.direction, xero.amount]);

    reply({ items: [{ id: '1', type: 'VendBill', foreigntotal: 250, foreignamountunpaid: 250, trandate: '2026-07-14' }] });
    const netsuite = (await ACCOUNTING_ADAPTERS.netsuite.fetchDocuments!(netsuiteCredential, WINDOW)).items[0]!;
    documents.push([netsuite.direction, netsuite.amount]);

    // The sentence the port's own doc comment leads with: "a Xero ACCPAY invoice
    // and a QuickBooks Bill are the same thing with opposite-signed totals in their
    // respective reports". Above this file, they are one shape.
    expect(documents).toEqual([['payable', 250], ['payable', 250], ['payable', 250]]);
  });
});
