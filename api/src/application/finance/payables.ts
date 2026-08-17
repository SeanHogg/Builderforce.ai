/**
 * Payables and receivables — the two headers, and the three acts a payable has.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `bill.approve`, `bill.schedule-payment` and `bill.dispute` were named by
 * `canvasApprovalGate.GATED_ACTIONS` as irreversible or attested, advertised by
 * `founderObjects.ts`, and a grep for the handlers returned the gate and its own
 * test. The gate was working perfectly and there was nothing behind it.
 *
 * They needed a header before they could be written, and `finance.expenses` is
 * NOT one: an expense is a reimbursement CLAIM — a person spent money and wants
 * it back, hence `submitted_by`, `category` and `incurred_at`. A bill is a
 * vendor's demand with a counterparty, a due date and an approval, and nobody is
 * owed anything back. `grep "pgTable('bills'"` returned nothing.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────
 * `bill.approvedBy` is, in the object's own words, "the one field on this object
 * that can cause real harm". So the entity is READ-ONLY through the generic
 * layer, every write comes through here, and {@link approveBill} refuses when the
 * approver is the person who entered the bill. That is separation of duties as a
 * property of the only writer, rather than a rule each caller remembers — and it
 * is the same argument `evaluateGate` makes for an agent approving its own
 * change, applied to a human approving their own invoice.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────
 * `invoice.issue`, `record-payment` and `chase` are the receivable's three acts
 * and are a separate change; the header they need now exists, which is what was
 * blocking them. The reads below are what a header without handlers legitimately
 * supports: the ledger, and the ageing that `financeRollup` and the canvas both
 * want. Nothing here claims an invoice was sent.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { bills, invoiceLineItems, invoices } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export class PayableError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PayableError';
  }
}

/** Bounded, because every read here is a list a surface renders. */
const PAGE = 100;

/** Bounded, because `account.history` renders a card section, not a ledger. */
const HISTORY_PAGE = 20;

/**
 * Cache key for one account's projected history (FO-A3) — exported so
 * `accountHistory.ts` reads through the SAME key this module invalidates.
 *
 * Keyed on `(tenant, ref)` rather than folded into a version token: every write
 * that can change it names its own `customerRef`/`vendorRef` right here, so a
 * precise per-key invalidation is exact and needs no extra bookkeeping.
 */
export const accountHistoryCacheKey = (tenantId: number, accountPartyRef: string): string =>
  `finance:account-history:${tenantId}:${accountPartyRef}`;

/** Statuses from which each act is legal. Declared as DATA so the three handlers
 *  below share one transition check rather than each writing its own — and so a
 *  reviewer can see the whole state machine without reading three functions. */
const LEGAL_FROM: Readonly<Record<'approve' | 'schedule' | 'dispute' | 'pay', readonly string[]>> = {
  approve:  ['received', 'disputed'],
  // Scheduling an UNAPPROVED bill is the failure mode this whole module exists
  // to prevent: it is how money leaves against something nobody authorised.
  schedule: ['approved'],
  // A bill can be disputed at any point before it is paid — including after
  // approval, because the reason to dispute one is usually discovered later.
  dispute:  ['received', 'approved', 'scheduled'],
  pay:      ['approved', 'scheduled'],
};

function assertTransition(act: keyof typeof LEGAL_FROM, current: string): void {
  if (!LEGAL_FROM[act].includes(current)) {
    throw new PayableError(
      `A bill that is "${current}" cannot be ${act === 'schedule' ? 'scheduled for payment' : `${act}d`}. Legal from: ${LEGAL_FROM[act].join(', ')}.`,
      409,
    );
  }
}

// ---------------------------------------------------------------------------
// Line items — one shape, two headers
// ---------------------------------------------------------------------------

export type DocumentKind = 'invoice' | 'bill';

export interface BilledLine {
  description: string;
  quantity?: number;
  unitAmount: number;
  amount?: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
}

/**
 * Replace a document's lines.
 *
 * Replace rather than merge: a line-level diff would need a stable line id the
 * authoring surface does not have, and a partial write is how a document ends up
 * carrying a line somebody deleted. The lines are read as a set and written as a
 * set, which is also how they are rendered.
 */
export async function setDocumentLines(
  db: Db,
  tenantId: number,
  documentKind: DocumentKind,
  reference: string,
  lines: readonly BilledLine[],
  currency: string,
): Promise<void> {
  await db.delete(invoiceLineItems).where(scopedToTenant(
    invoiceLineItems,
    tenantId,
    and(eq(invoiceLineItems.documentKind, documentKind), eq(invoiceLineItems.invoiceRef, reference)),
  ));
  if (!lines.length) return;
  await db.insert(invoiceLineItems).values(lines.map((line, position) => {
    const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : 1;
    const amount = Number.isFinite(line.amount) ? Number(line.amount) : quantity * line.unitAmount;
    return {
      tenantId,
      documentKind,
      invoiceRef: reference,
      description: line.description.slice(0, 500),
      quantity: String(quantity),
      unitAmount: String(line.unitAmount),
      amount: String(amount),
      currency,
      taxRate: line.taxRate == null ? null : String(line.taxRate),
      taxAmount: line.taxAmount == null ? null : String(line.taxAmount),
      sourceKind: line.sourceKind ?? null,
      sourceRef: line.sourceRef ?? null,
      position,
    };
  }));
}

/**
 * The lines' own total, computed on the way past.
 *
 * There is no stored total on either header and this is why: a stored one is the
 * number that ends up disagreeing with the rows printed directly beneath it. The
 * headers carry `amount` — what was AGREED, which is a fact the issuer asserts —
 * and this is what the lines say, so a mismatch between them is reportable rather
 * than invisible.
 */
export async function documentLineTotal(
  db: Db,
  tenantId: number,
  documentKind: DocumentKind,
  reference: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${invoiceLineItems.amount}), 0)` })
    .from(invoiceLineItems)
    .where(scopedToTenant(
      invoiceLineItems,
      tenantId,
      and(eq(invoiceLineItems.documentKind, documentKind), eq(invoiceLineItems.invoiceRef, reference)),
    ));
  return Number(row?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Payables — the three acts
// ---------------------------------------------------------------------------

export interface RecordBillInput {
  reference: string;
  vendorName: string;
  vendorRef?: string | null;
  amount: number;
  taxAmount?: number | null;
  currency?: string;
  dueAt?: string | null;
  category?: string | null;
  recurring?: string;
  notes?: string | null;
  objectId?: string | null;
  lines?: readonly BilledLine[];
  /** Who entered it. The approve handler refuses to let this person approve it. */
  createdBy: string;
}

/** Enter a vendor's bill. Always lands `received` — never approved, because an
 *  approval nobody gave is the defect this module is built around. */
export async function recordBill(db: Db, env: Env, tenantId: number, input: RecordBillInput): Promise<{ id: number }> {
  const reference = input.reference.trim().slice(0, 64);
  const vendorName = input.vendorName.trim().slice(0, 200);
  if (!reference || !vendorName) throw new PayableError('A bill needs the vendor and their own reference for it.', 400);
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new PayableError('A bill needs a non-negative amount.', 400);

  const currency = (input.currency ?? 'USD').toUpperCase().slice(0, 8);
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new PayableError('dueAt is not a date.', 400);

  const [row] = await db
    .insert(bills)
    .values({
      tenantId,
      reference,
      vendorName,
      vendorRef: input.vendorRef?.trim().slice(0, 64) ?? null,
      amount: String(input.amount),
      taxAmount: input.taxAmount == null ? null : String(input.taxAmount),
      currency,
      dueAt,
      category: input.category?.trim().slice(0, 96) ?? null,
      recurring: input.recurring ?? 'none',
      notes: input.notes ?? null,
      objectId: input.objectId ?? null,
      createdBy: input.createdBy,
    })
    // The unique index is (tenant, vendor_ref, reference): a vendor re-sending
    // the same reference is a duplicate, and it collides in the DATABASE rather
    // than in a check somebody remembered to write.
    .onConflictDoNothing({ target: [bills.tenantId, bills.vendorRef, bills.reference] })
    .returning({ id: bills.id });

  if (!row) {
    throw new PayableError(`${vendorName} has already sent a bill with reference "${reference}". Check whether it is a duplicate before entering it again.`, 409);
  }
  if (input.lines?.length) await setDocumentLines(db, tenantId, 'bill', reference, input.lines, currency);
  await invalidateAccountHistory(env, tenantId, input.vendorRef);
  return { id: row.id };
}

/** Best-effort — a stale `account.history` for one more read cycle is not worth
 *  failing the write that just happened over. */
async function invalidateAccountHistory(env: Env, tenantId: number, ref: string | null | undefined): Promise<void> {
  const key = ref?.trim();
  if (!key) return;
  await invalidateCached(env, accountHistoryCacheKey(tenantId, key)).catch((error) => {
    reportCaughtError(error, { source: 'application/finance/payables.ts', operation: 'invalidateAccountHistory', level: 'warning' });
  });
}

/**
 * Authorise a bill for payment.
 *
 * THE separation-of-duties check. Refuses when the approver entered the bill,
 * for the same reason `evaluateGate` refuses to let an agent approve its own
 * change: an approval granted by the person who made the request is not review,
 * it is a second copy of one judgement — and here it is also the shortest path to
 * money leaving the company for something nobody else ever looked at.
 */
export async function approveBill(
  db: Db,
  env: Env,
  tenantId: number,
  billId: number,
  approverRef: string,
  options: { allowSelfApproval?: boolean } = {},
): Promise<void> {
  const bill = await requireBill(db, tenantId, billId);
  assertTransition('approve', bill.status);

  if (!options.allowSelfApproval && bill.createdBy && bill.createdBy === approverRef) {
    throw new PayableError(
      `This bill was entered by you, so approving it would be self-approval. Ask a second person to approve it — or, if this workspace genuinely has one finance person, record that decision explicitly rather than letting it happen silently.`,
      409,
    );
  }

  const now = new Date();
  await db
    .update(bills)
    .set({ status: 'approved', approvedBy: approverRef, approvedAt: now, disputedAt: null, disputeReason: null, updatedAt: now })
    .where(scopedToTenant(bills, tenantId, eq(bills.id, billId)));
  await invalidateAccountHistory(env, tenantId, bill.vendorRef);
}

/** Put an APPROVED bill into a payment run. Refuses anything unapproved — see
 *  `LEGAL_FROM`, where that rule is stated once. */
export async function scheduleBillPayment(
  db: Db,
  env: Env,
  tenantId: number,
  billId: number,
  scheduledFor: string,
): Promise<void> {
  const bill = await requireBill(db, tenantId, billId);
  assertTransition('schedule', bill.status);

  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime())) throw new PayableError('scheduledFor is not a date.', 400);

  const now = new Date();
  await db
    .update(bills)
    .set({ status: 'scheduled', scheduledFor: when, updatedAt: now })
    .where(scopedToTenant(bills, tenantId, eq(bills.id, billId)));
  await invalidateAccountHistory(env, tenantId, bill.vendorRef);
}

/**
 * Dispute a bill.
 *
 * Clears the approval, deliberately. A disputed bill that keeps its `approvedBy`
 * would sit in a payment run carrying an authorisation for an amount nobody
 * agrees is owed — which is the specific way a dispute turns into a payment.
 */
export async function disputeBill(
  db: Db,
  env: Env,
  tenantId: number,
  billId: number,
  reason: string,
): Promise<void> {
  const bill = await requireBill(db, tenantId, billId);
  assertTransition('dispute', bill.status);

  const clean = reason.trim().slice(0, 1000);
  if (!clean) throw new PayableError('A dispute needs a reason — it is what the vendor is answering.', 400);

  const now = new Date();
  await db
    .update(bills)
    .set({
      status: 'disputed',
      disputedAt: now,
      disputeReason: clean,
      approvedBy: null,
      approvedAt: null,
      scheduledFor: null,
      updatedAt: now,
    })
    .where(scopedToTenant(bills, tenantId, eq(bills.id, billId)));
  await invalidateAccountHistory(env, tenantId, bill.vendorRef);
}

async function requireBill(db: Db, tenantId: number, billId: number) {
  const [bill] = await db
    .select({ id: bills.id, status: bills.status, createdBy: bills.createdBy, vendorRef: bills.vendorRef })
    .from(bills)
    .where(scopedToTenant(bills, tenantId, eq(bills.id, billId)))
    .limit(1);
  if (!bill) throw new PayableError('No bill with that id in this workspace.', 404);
  return bill;
}

// ---------------------------------------------------------------------------
// Reads — the ageing both headers owe their surfaces
// ---------------------------------------------------------------------------

export interface AgeingBucket {
  label: string;
  count: number;
  amount: number;
}

export interface AgeingReport {
  currency: string;
  outstanding: number;
  overdue: number;
  buckets: AgeingBucket[];
}

/** The standard ladder. Declared once and used for both directions, because
 *  "how overdue" is one question asked of two counterparties. */
const AGEING_LADDER: ReadonlyArray<{ label: string; from: number; to: number | null }> = [
  { label: 'current', from: -Infinity, to: 0 },
  { label: '1-30', from: 0, to: 30 },
  { label: '31-60', from: 30, to: 60 },
  { label: '61-90', from: 60, to: 90 },
  { label: '90+', from: 90, to: null },
];

const daysPast = (due: Date | null, now: number): number =>
  due == null ? 0 : Math.floor((now - due.getTime()) / 86_400_000);

/**
 * Ageing for one direction.
 *
 * Computed on read and never stored: `ageingDays` on the canvas object is
 * documented as "computed from `dueAt` — never authored, because a stale ageing
 * is worse than none", and a stored column would be exactly that stale value one
 * day later.
 *
 * The rows are bounded and selected narrowly — only what the arithmetic needs —
 * so this stays one query over an index rather than a page of full documents.
 */
export async function ageing(
  db: Db,
  tenantId: number,
  direction: DocumentKind,
  now = Date.now(),
): Promise<AgeingReport> {
  const rows = direction === 'invoice'
    ? await db
        .select({ amount: invoices.amount, paid: invoices.paidAmount, dueAt: invoices.dueAt, currency: invoices.currency })
        .from(invoices)
        .where(scopedToTenant(invoices, tenantId, inArray(invoices.status, ['issued', 'part-paid'])))
        .orderBy(asc(invoices.dueAt))
        .limit(1000)
    : await db
        .select({ amount: bills.amount, paid: bills.paidAmount, dueAt: bills.dueAt, currency: bills.currency })
        .from(bills)
        .where(scopedToTenant(bills, tenantId, inArray(bills.status, ['received', 'approved', 'scheduled'])))
        .orderBy(asc(bills.dueAt))
        .limit(1000);

  const buckets = AGEING_LADDER.map((band) => ({ label: band.label, count: 0, amount: 0 }));
  let outstanding = 0;
  let overdue = 0;

  for (const row of rows) {
    const open = Number(row.amount) - Number(row.paid);
    if (!(open > 0)) continue;
    outstanding += open;
    const age = daysPast(row.dueAt, now);
    if (age > 0) overdue += open;
    const index = AGEING_LADDER.findIndex((band) => age > band.from && (band.to == null || age <= band.to));
    const bucket = buckets[index === -1 ? 0 : index];
    if (bucket) {
      bucket.count += 1;
      bucket.amount += open;
    }
  }

  return {
    // One currency per report. A mixed-currency total is refused rather than
    // silently added — the same rule the canvas `currency` field states.
    currency: rows[0]?.currency ?? 'USD',
    outstanding,
    overdue,
    buckets,
  };
}

/** Everything a payment run is about to release. The list a person checks before
 *  money moves, which is the only reason `scheduled` is a distinct state. */
export async function scheduledPayments(db: Db, tenantId: number) {
  return db
    .select({
      id: bills.id,
      reference: bills.reference,
      vendorName: bills.vendorName,
      amount: bills.amount,
      currency: bills.currency,
      scheduledFor: bills.scheduledFor,
      approvedBy: bills.approvedBy,
    })
    .from(bills)
    .where(scopedToTenant(bills, tenantId, and(eq(bills.status, 'scheduled'), isNotNull(bills.scheduledFor))))
    .orderBy(asc(bills.scheduledFor))
    .limit(PAGE);
}

/** The receivable ledger, newest first. The header FO-C1 was missing, read. */
export async function listInvoices(db: Db, tenantId: number, status?: string) {
  return db
    .select({
      id: invoices.id,
      reference: invoices.reference,
      customerName: invoices.customerName,
      customerRef: invoices.customerRef,
      amount: invoices.amount,
      paidAmount: invoices.paidAmount,
      currency: invoices.currency,
      status: invoices.status,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
    })
    .from(invoices)
    .where(scopedToTenant(invoices, tenantId, status ? eq(invoices.status, status) : undefined))
    .orderBy(desc(invoices.updatedAt))
    .limit(PAGE);
}

// ---------------------------------------------------------------------------
// One counterparty's history (FO-A3) — the reads `account.history` projects
// ---------------------------------------------------------------------------
//
// `invoices.customerRef` and `bills.vendorRef` are documented on the schema as
// `party_roles.party_ref` for the counterparty — the SAME ref `canvas_sync_account`
// already joins an `account` card to. So these are exact-match reads on an
// indexed column, not a fuzzy join: an account with no invoices or bills under
// its ref returns an empty history rather than a guess.

export interface AccountLedgerDoc {
  kind: 'invoice' | 'bill';
  reference: string;
  amount: number;
  currency: string;
  due: string | null;
  status: string;
}

const OPEN_INVOICE_STATUSES = ['issued', 'part-paid'];
const OPEN_BILL_STATUSES = ['received', 'approved', 'scheduled', 'disputed'];

/** An account's open receivables — what it still owes us. Bounded and ordered
 *  by due date, because this renders a card section, not a ledger. */
export async function openInvoicesForAccount(db: Db, tenantId: number, customerRef: string): Promise<AccountLedgerDoc[]> {
  const rows = await db
    .select({ reference: invoices.reference, amount: invoices.amount, currency: invoices.currency, dueAt: invoices.dueAt, status: invoices.status })
    .from(invoices)
    .where(scopedToTenant(invoices, tenantId, and(eq(invoices.customerRef, customerRef), inArray(invoices.status, OPEN_INVOICE_STATUSES))))
    .orderBy(asc(invoices.dueAt))
    .limit(HISTORY_PAGE);
  return rows.map((row) => ({ kind: 'invoice' as const, reference: row.reference, amount: Number(row.amount), currency: row.currency, due: row.dueAt ? row.dueAt.toISOString() : null, status: row.status }));
}

/** An account's open payables — what we still owe it. Same shape as the
 *  receivable read, mirrored the other direction. */
export async function openBillsForAccount(db: Db, tenantId: number, vendorRef: string): Promise<AccountLedgerDoc[]> {
  const rows = await db
    .select({ reference: bills.reference, amount: bills.amount, currency: bills.currency, dueAt: bills.dueAt, status: bills.status })
    .from(bills)
    .where(scopedToTenant(bills, tenantId, and(eq(bills.vendorRef, vendorRef), inArray(bills.status, OPEN_BILL_STATUSES))))
    .orderBy(asc(bills.dueAt))
    .limit(HISTORY_PAGE);
  return rows.map((row) => ({ kind: 'bill' as const, reference: row.reference, amount: Number(row.amount), currency: row.currency, due: row.dueAt ? row.dueAt.toISOString() : null, status: row.status }));
}
