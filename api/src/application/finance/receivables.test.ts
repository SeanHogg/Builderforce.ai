/**
 * The receivable's rules, tested where they are decidable without a database.
 *
 * Three of them, and each is a rule that produces real financial harm when it is
 * wrong rather than a formatting preference:
 *
 *  • THE LADDER'S CADENCE. `nextRung` decides which reminder a customer gets and
 *    when. The failure it exists to prevent — an invoice imported ninety days
 *    overdue receiving four escalating emails inside one minute, in the wrong
 *    order, ending at a final notice — is invisible in code review and obvious in
 *    a customer's inbox.
 *  • THE DENOMINATION. `ledger_entries` keys uniqueness on
 *    `(tenant, denomination, reference)`, so a EUR receipt landing in `usd_cents`
 *    would both mis-total the invoice and let a genuinely different payment
 *    collide with it.
 *  • THE PROVIDER SHAPES. `normalisePayRuns` is the one place that knows a Gusto
 *    `totals.company_debit` is the same fact as a Rippling `total_cost`. A run it
 *    silently imports as zero reduces the burn on a forecast, which is the one
 *    direction an error must never go.
 */
import { describe, expect, it } from 'vitest';
import { COLLECTION_LADDER, nextRung } from './collectionsLadder';
import { ageingDays, denominationFor } from './receivables';
import { normalisePayRuns, payRunReference } from './payRuns';
import { invoiceBlocks } from './invoicePdf';

describe('the collections ladder', () => {
  it('is ordered and has no duplicate step, which is what the unique index keys on', () => {
    const steps = COLLECTION_LADDER.map((rung) => rung.step);
    expect(new Set(steps).size).toBe(steps.length);
    const days = COLLECTION_LADDER.map((rung) => rung.atDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('ends at a person rather than at a harsher email', () => {
    expect(COLLECTION_LADDER[COLLECTION_LADDER.length - 1]?.channel).toBe('internal');
  });

  it('reminds BEFORE the due date, which is the only reminder that prevents anything', () => {
    expect(COLLECTION_LADDER[0]?.atDays).toBeLessThan(0);
  });

  it('offers nothing while the invoice is not yet near its due date', () => {
    expect(nextRung(-30, new Set())).toBeNull();
  });

  it('climbs ONE rung at a time on an invoice that is eligible for all of them', () => {
    // The defect this is here for: an invoice imported ninety days overdue must
    // not receive every reminder at once.
    const first = nextRung(90, new Set());
    expect(first).not.toBeNull();
    const second = nextRung(90, new Set([first!.step]));
    expect(second).not.toBeNull();
    expect(second!.step).not.toBe(first!.step);
  });

  it('offers the HIGHEST due rung, not the oldest one still unclimbed', () => {
    // Chasing somebody about a threshold three weeks past with the words of the
    // gentlest reminder is worse than not chasing them.
    expect(nextRung(90, new Set())?.step).toBe(COLLECTION_LADDER[COLLECTION_LADDER.length - 1]?.step);
  });

  it('runs dry once every rung is climbed, so a paid-late invoice stops being chased', () => {
    expect(nextRung(365, new Set(COLLECTION_LADDER.map((rung) => rung.step)))).toBeNull();
  });
});

describe('ageing', () => {
  const due = new Date('2026-08-01T00:00:00.000Z');

  it('is zero for an invoice with no due date — it cannot age', () => {
    expect(ageingDays(null)).toBe(0);
  });

  it('is negative before the due date and positive after it', () => {
    expect(ageingDays(due, Date.parse('2026-07-28T00:00:00.000Z'))).toBeLessThan(0);
    expect(ageingDays(due, Date.parse('2026-08-11T00:00:00.000Z'))).toBe(10);
  });
});

describe('the ledger denomination', () => {
  it('is minor units of the invoice currency, not the platform default', () => {
    expect(denominationFor('EUR')).toBe('eur_cents');
    expect(denominationFor('usd')).toBe('usd_cents');
  });

  it('falls back rather than producing a `_cents` key nothing can be summed against', () => {
    expect(denominationFor('')).toBe('usd_cents');
  });
});

describe('pay-run normalisation', () => {
  it('reads a Gusto-shaped run, including the total that is burn', () => {
    const [run] = normalisePayRuns({
      payrolls: [{
        id: 'p-1',
        processed: true,
        check_date: '2026-07-31',
        pay_period_start_date: '2026-07-01',
        pay_period_end_date: '2026-07-31',
        totals: { company_debit: '48250.00', gross_pay: '39000.00', employer_taxes: '6100.00' },
        employee_compensations: [
          { employee_uuid: 'e-1', gross_pay: 5000, hours: 160, rate: 31.25 },
        ],
      }],
    });
    expect(run?.totalCost).toBe(48250);
    expect(run?.grossAmount).toBe(39000);
    expect(run?.status).toBe('processed');
    expect(run?.paidAt).toBe('2026-07-31');
    expect(run?.lines?.[0]?.amount).toBe(5000);
    expect(run?.employeeCount).toBe(1);
  });

  it('reads a Rippling-shaped run out of a different envelope and different field names', () => {
    const [run] = normalisePayRuns({
      results: [{ id: 'r-9', status: 'PROCESSED', total_cost: 12000, pay_date: '2026-06-30' }],
    });
    expect(run?.externalRef).toBe('r-9');
    expect(run?.totalCost).toBe(12000);
    expect(run?.status).toBe('processed');
  });

  it('DROPS a run with no identifiable total rather than importing it as zero', () => {
    // A zero-cost pay run quietly reduces the burn on a forecast. A missing run is
    // visible; a wrong one is not.
    expect(normalisePayRuns({ payrolls: [{ id: 'p-2', totals: {} }] })).toEqual([]);
  });

  it('drops a run with no id, because nothing could make re-reading it idempotent', () => {
    expect(normalisePayRuns([{ total_cost: 100 }])).toEqual([]);
  });

  it('treats anything not clearly finished as open, so it stays out of burn', () => {
    const [run] = normalisePayRuns([{ id: 'p-3', total_cost: 100, status: 'draft' }]);
    expect(run?.status).toBe('draft');
    const [unknown] = normalisePayRuns([{ id: 'p-4', total_cost: 100 }]);
    expect(unknown?.status).toBe('open');
  });

  it('derives a stable reference, so re-reading the same run finds its own lines', () => {
    expect(payRunReference('gusto', 'p-1')).toBe('gusto:p-1');
  });
});

describe('the invoice document', () => {
  const issuer = { name: 'Northwind Ltd', accent: '#111111', secondary: '#222222' };
  const base = {
    reference: 'INV-1042',
    customerName: 'Acme Holdings',
    currency: 'USD',
    status: 'issued',
    amount: 1200,
    paidAmount: 0,
    outstanding: 1200,
    issuedAtISO: '2026-08-01T00:00:00.000Z',
    dueAtISO: '2026-08-31T00:00:00.000Z',
    ageingDays: 0,
    notes: null,
    paymentLinkUrl: null,
    lines: [] as Array<{ description: string; quantity: number; unitAmount: number; amount: number }>,
  };
  const cells = (blocks: ReturnType<typeof invoiceBlocks>): string[] =>
    blocks.flatMap((block) => (block.kind === 'table' ? block.rows.flat() : block.kind === 'paragraph' ? [block.text] : []));

  it('names both parties, because a document that says who owes without saying who to is not one', () => {
    const text = cells(invoiceBlocks(base, issuer));
    expect(text).toContain('Northwind Ltd');
    expect(text).toContain('Acme Holdings');
  });

  it('prints the AGREED total even with no lines — the schema says `amount` is what was asserted', () => {
    expect(cells(invoiceBlocks(base, issuer))).toContain('$1,200.00');
  });

  it('omits a "Paid" line while nothing has landed', () => {
    // "Paid $0.00" on a fresh invoice invites the reader to wonder what went wrong.
    expect(cells(invoiceBlocks(base, issuer))).not.toContain('Paid');
  });

  it('shows what is still owed on a part-paid invoice, not just the gross', () => {
    const text = cells(invoiceBlocks({ ...base, paidAmount: 500, outstanding: 700 }, issuer));
    expect(text).toContain('$500.00');
    expect(text).toContain('$700.00');
  });

  it('offers the payment link only while there is something to pay', () => {
    const open = cells(invoiceBlocks({ ...base, paymentLinkUrl: 'https://pay.example/x' }, issuer));
    expect(open.some((line) => line.includes('https://pay.example/x'))).toBe(true);

    // A settled invoice rendering a live checkout link is how a customer pays twice.
    const settled = cells(invoiceBlocks({ ...base, paidAmount: 1200, outstanding: 0, paymentLinkUrl: 'https://pay.example/x' }, issuer));
    expect(settled.some((line) => line.includes('https://pay.example/x'))).toBe(false);
    expect(settled.some((line) => line.includes('settled'))).toBe(true);
  });

  it('formats money the same way for every reader — the FILE is not localised', () => {
    // Two people opening one invoice in two countries quote the figures to each
    // other; a copy reading "1.234,56" beside one reading "1,234.56" is, to them,
    // a different invoice.
    const text = cells(invoiceBlocks({ ...base, amount: 1234.56, outstanding: 1234.56 }, issuer));
    expect(text).toContain('$1,234.56');
  });
});
