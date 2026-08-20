/**
 * Receivables — the three acts an invoice has, and the money that lands on it.
 *
 * ── WHAT THIS CLOSES (FO-C2) ─────────────────────────────────────────────────
 * `invoice.issue`, `record-payment` and `chase` were named by
 * `canvasApprovalGate.GATED_ACTIONS` as irreversible or attested, advertised by
 * `founderObjects.ts`, and a grep for the handlers returned the gate and its own
 * test. Exactly the shape `payables.ts` found on the other side of the ledger:
 * the gate was working perfectly and there was nothing behind it. 0469 built the
 * header and said so — "the receivable's three acts are a separate change; the
 * header they need now exists, which is what was blocking them". This is that
 * change.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────
 * `payables.ts` has one: an approver may not be the person who entered the bill.
 * The receivable's equivalent is narrower and harder — **an invoice is issued
 * once**. Issuing is what makes a document a legal record of what was sent: the
 * customer now holds a paper with a number, a date and an amount on it, and
 * re-issuing the same reference with different figures produces two documents
 * that disagree and one customer who reasonably pays the smaller. So
 * {@link issueInvoice} refuses anything that is not a draft, and the amount, the
 * customer and the lines are frozen at that moment.
 *
 * The mirror of that rule is that a payment is recorded ONCE, and the enforcement
 * is not in this file at all — it is the unique index on
 * `ledger_entries (tenant, denomination, reference)`. A retried webhook, a
 * double-clicked button and a redirect the customer refreshed all collide in the
 * DATABASE rather than in a check somebody remembered to write, which is the same
 * argument `listingCommerce.creditSeller` already makes about a marketplace sale.
 *
 * ── WHY A PAYMENT IS A LEDGER ROW AND NOT AN `invoice_payments` TABLE ────────
 * Because money that moved is the one thing `ledger_entries` exists to hold — 59
 * balance tables were consolidated into it on the argument that a new money shape
 * is a `denomination` value rather than DDL. A receipt against an invoice is a
 * new VALUE (`entry_kind = 'receipt'`), and `invoices.paidAmount` is the
 * materialised running total the surfaces read, exactly as `balanceAfter` is on
 * the ledger itself and for the same stated reason: summing an unbounded history
 * on every read is the performance anti-pattern this platform rejects.
 *
 * ── WHAT `chase` IS, AND IS NOT ──────────────────────────────────────────────
 * One rung of the collections ladder, climbed by a person. The ladder itself — the
 * rungs, when each is due, and the sweep that finds them — is
 * `collectionsLadder.ts`; this file holds the act, so a human chase and an
 * automated one write the same row through the same function and cannot drift
 * into two collections histories.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  collectionActions,
  invoiceLineItems,
  invoices,
  ledgerEntries,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { verifyPaidCheckout } from './verifiedCheckout';
import { hashShareToken, mintShareToken } from '../security/shareToken';
import { deliverShareInvitations } from '../security/shareInvitationMailer';
import { recordActivity } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { accountHistoryCacheKey, documentLineTotal, setDocumentLines, type BilledLine } from './payables';
import { chargeableMerchantId } from './merchantAccount';

export class ReceivableError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ReceivableError';
  }
}

/** Bounded, because every read here renders a list on a surface. */
const PAGE = 100;

/** How many days an invoice is payable for when the issuer names no due date.
 *  Stated once rather than defaulted at three call sites, and stated at all
 *  because an invoice with no due date cannot age — see the field's own hint. */
const DEFAULT_PAYMENT_TERM_DAYS = 30;

/** The statuses an invoice may be paid against. `draft` is absent deliberately:
 *  money arriving for a document nobody has sent is a reconciliation problem, and
 *  recording it against a draft would let the draft be edited afterwards. */
const PAYABLE_STATUSES = ['issued', 'part-paid'] as const;

/**
 * The ledger denomination for one currency.
 *
 * `denomination` is the column that replaced 59 balance tables, so a EUR receipt
 * is `eur_cents` rather than a second table or — worse — a USD row carrying euros.
 * Minor units, matching `usd_cents` everywhere else on the platform.
 */
export const denominationFor = (currency: string): string =>
  `${(currency || 'USD').trim().toLowerCase().slice(0, 8)}_cents`;

/** Money as the ledger holds it. One rounding, in one place, so a half-cent
 *  cannot be rounded one way by the webhook and the other by the manual path. */
const toCents = (amount: number): number => Math.round(amount * 100);

// ---------------------------------------------------------------------------
// The draft — what the acts operate on
// ---------------------------------------------------------------------------

export interface DraftInvoiceInput {
  /** Our own invoice number. The natural key the lines resolve to. */
  reference: string;
  customerName: string;
  customerRef?: string | null;
  amount: number;
  taxAmount?: number | null;
  currency?: string;
  dueAt?: string | null;
  notes?: string | null;
  objectId?: string | null;
  lines?: readonly BilledLine[];
  /** 'off' | 'notify' | 'auto' — how hard the ladder may work this one. */
  collectionMode?: string;
  createdBy: string;
}

const COLLECTION_MODES = ['off', 'notify', 'auto'] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

const cleanMode = (value: string | null | undefined): CollectionMode =>
  (COLLECTION_MODES as readonly string[]).includes(String(value)) ? value as CollectionMode : 'notify';

/**
 * Create or update a DRAFT receivable, and its lines.
 *
 * Upsert rather than insert, because the canvas is the front door: an `invoice`
 * card is authored, edited and re-synced, and a create-only handler would make
 * the second sync of the same reference an error the user cannot resolve without
 * knowing that a row they never saw already exists.
 *
 * It refuses to touch anything already ISSUED. That is the freeze: after the act
 * that put a document in a customer's hands, this is no longer the writer — the
 * remaining legal changes are a payment, a credit note or a write-off, and each
 * has its own handler.
 */
export async function upsertInvoiceDraft(
  db: Db,
  env: Env,
  tenantId: number,
  input: DraftInvoiceInput,
): Promise<{ id: number; reference: string; status: string }> {
  const reference = input.reference.trim().slice(0, 64);
  const customerName = input.customerName.trim().slice(0, 200);
  if (!reference || !customerName) throw new ReceivableError('An invoice needs your own reference for it and the customer it is addressed to.', 400);
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ReceivableError('An invoice needs a non-negative amount.', 400);

  const currency = (input.currency ?? 'USD').toUpperCase().slice(0, 8);
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new ReceivableError('dueAt is not a date.', 400);

  const existing = await findInvoiceByReference(db, tenantId, reference);
  if (existing && existing.status !== 'draft') {
    throw new ReceivableError(
      `Invoice ${reference} is "${existing.status}" and can no longer be edited — an issued invoice is a record of what the customer was actually sent. Record a payment, or raise a credit note against it.`,
      409,
    );
  }

  const values = {
    tenantId,
    reference,
    customerName,
    customerRef: input.customerRef?.trim().slice(0, 64) ?? null,
    amount: String(input.amount),
    taxAmount: input.taxAmount == null ? null : String(input.taxAmount),
    currency,
    dueAt,
    notes: input.notes ?? null,
    objectId: input.objectId ?? null,
    collectionMode: cleanMode(input.collectionMode),
    createdBy: input.createdBy,
  };

  const [row] = await db
    .insert(invoices)
    .values(values)
    .onConflictDoUpdate({
      target: [invoices.tenantId, invoices.reference],
      set: {
        customerName: values.customerName,
        customerRef: values.customerRef,
        amount: values.amount,
        taxAmount: values.taxAmount,
        currency: values.currency,
        dueAt: values.dueAt,
        notes: values.notes,
        objectId: values.objectId,
        collectionMode: values.collectionMode,
        updatedAt: new Date(),
      },
    })
    .returning({ id: invoices.id });

  if (!row) throw new ReceivableError('The invoice could not be written.', 500);
  if (input.lines) await setDocumentLines(db, tenantId, 'invoice', reference, input.lines, currency);
  await invalidateAccountHistory(env, tenantId, values.customerRef);
  return { id: row.id, reference, status: 'draft' };
}

/** Best-effort — a stale `account.history` for one more read cycle is not worth
 *  failing the write that just happened over. Mirrors `payables.ts`, which owns
 *  the key both modules invalidate. */
async function invalidateAccountHistory(env: Env, tenantId: number, ref: string | null | undefined): Promise<void> {
  const key = ref?.trim();
  if (!key) return;
  await invalidateCached(env, accountHistoryCacheKey(tenantId, key)).catch((error) => {
    reportCaughtError(error, { source: 'application/finance/receivables.ts', operation: 'invalidateAccountHistory', level: 'warning' });
  });
}

/** The columns every act here needs. Selected narrowly and in one place so the
 *  three handlers cannot disagree about what an invoice is. */
const INVOICE_COLUMNS = {
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
  sentTo: invoices.sentTo,
  paymentLinkUrl: invoices.paymentLinkUrl,
  collectionMode: invoices.collectionMode,
  objectId: invoices.objectId,
} as const;

/** What {@link INVOICE_COLUMNS} selects, written out. Declared rather than
 *  derived from the column map: a mapped type over Drizzle columns loses the
 *  nullability, which is the one property every caller here has to respect. */
export interface InvoiceRow {
  id: number;
  reference: string;
  customerName: string;
  customerRef: string | null;
  amount: string;
  paidAmount: string;
  currency: string;
  status: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  sentTo: string | null;
  paymentLinkUrl: string | null;
  collectionMode: string;
  objectId: string | null;
}

async function findInvoiceByReference(db: Db, tenantId: number, reference: string): Promise<InvoiceRow | null> {
  const [row] = await db
    .select(INVOICE_COLUMNS)
    .from(invoices)
    .where(scopedToTenant(invoices, tenantId, eq(invoices.reference, reference)))
    .limit(1);
  return row ?? null;
}

/** The invoice an act names, or a 404 that says which reference was not found. */
export async function requireInvoice(db: Db, tenantId: number, reference: string): Promise<InvoiceRow> {
  const row = await findInvoiceByReference(db, tenantId, reference.trim().slice(0, 64));
  if (!row) throw new ReceivableError(`No invoice with reference "${reference}" in this workspace.`, 404);
  return row;
}

// ---------------------------------------------------------------------------
// Act 1 — issue
// ---------------------------------------------------------------------------

export interface IssueInvoiceResult {
  reference: string;
  status: string;
  issuedAtISO: string;
  dueAtISO: string | null;
  /** The customer's own address for the document. Carries the credential. */
  documentUrl: string;
  /** Null when the workspace has no chargeable merchant account (FO-C4). An
   *  invoice with no link is still an invoice; it is paid by bank transfer. */
  paymentLinkUrl: string | null;
  /** Whether the document was actually emailed, and to whom. */
  deliveredTo: string | null;
  /** What the LINES add up to, when that disagrees with the header. Reported
   *  rather than silently reconciled — see `documentLineTotal`. */
  lineTotalMismatch: number | null;
}

/**
 * Issue an invoice: freeze it, address it, price the way to pay it, and send it.
 *
 * ── WHY THE DOCUMENT LINK IS A TOKEN AND NOT A GUESSABLE URL ────────────────
 * The recipient has no Builderforce account and never will, so the token IS the
 * authorisation — the same position `form_recipients` and the signature parties
 * are in, and the same primitive (`mintShareToken`): only the hash is stored, the
 * plaintext exists for the length of this call, and a dump of the invoices table
 * cannot mint a working link.
 *
 * ── WHY DELIVERY FAILURE DOES NOT UNDO THE ISSUE ────────────────────────────
 * Because the state that matters is "this document is final and its figures may
 * no longer change", and that becomes true the moment we decide to send it.
 * Rolling it back on a bounced address would leave an editable draft whose
 * reference a customer may already have been quoted. So the row records `sentTo`
 * and `sentAt` only on a real delivery, the caller is TOLD delivery failed, and
 * the invoice is issued either way — which is also what lets an invoice be issued
 * with no recipient at all, for one handed over in person.
 */
export async function issueInvoice(
  db: Db,
  env: Env,
  tenantId: number,
  input: {
    reference: string;
    /** Where to send it. Omit to issue without delivering. */
    deliverTo?: string | null;
    /** Overrides the draft's own due date at the moment of issue. */
    dueAt?: string | null;
    /** Who is standing behind the document. From the session, never the body. */
    issuedBy: string;
    /** The words on the covering email. The caller owns them — see
     *  `shareInvitationMailer`, which makes the same argument. */
    message?: string | null;
  },
): Promise<IssueInvoiceResult> {
  const invoice = await requireInvoice(db, tenantId, input.reference);
  if (invoice.status !== 'draft') {
    throw new ReceivableError(
      `Invoice ${invoice.reference} is already "${invoice.status}". An invoice is issued once — re-issuing it would put two documents with the same number and different figures in one customer's hands.`,
      409,
    );
  }
  const amount = Number(invoice.amount);
  if (!(amount > 0)) {
    throw new ReceivableError('An invoice for nothing cannot be issued. Put an amount on it first.', 400);
  }

  const now = new Date();
  const explicitDue = input.dueAt ? new Date(input.dueAt) : null;
  if (explicitDue && Number.isNaN(explicitDue.getTime())) throw new ReceivableError('dueAt is not a date.', 400);
  // An invoice with no due date cannot age and cannot be chased, which makes the
  // whole collections half unreachable. Defaulting is better than the alternative
  // — refusing — because the term is a convention the issuer rarely thinks about
  // and the ladder is the feature they actually want.
  const dueAt = explicitDue
    ?? invoice.dueAt
    ?? new Date(now.getTime() + DEFAULT_PAYMENT_TERM_DAYS * 86_400_000);

  const { token, tokenHash } = await mintShareToken();
  const documentUrl = invoiceDocumentUrl(env, invoice.reference, token);

  // The payment link is minted BEFORE the status moves, so an invoice never
  // reaches a customer's inbox announcing a link that failed to be created.
  const paymentLinkUrl = await mintPaymentLink(db, env, tenantId, {
    reference: invoice.reference,
    customerName: invoice.customerName,
    amountCents: toCents(amount),
    currency: invoice.currency,
    billingEmail: input.deliverTo ?? null,
    documentUrl,
  });

  await db
    .update(invoices)
    .set({
      status: 'issued',
      issuedAt: now,
      dueAt,
      issuedBy: input.issuedBy,
      documentTokenHash: tokenHash,
      paymentLinkUrl: paymentLinkUrl?.url ?? null,
      paymentSessionId: paymentLinkUrl?.sessionId ?? null,
      updatedAt: now,
    })
    .where(scopedToTenant(invoices, tenantId, eq(invoices.id, invoice.id)));

  let deliveredTo: string | null = null;
  const recipient = input.deliverTo?.trim();
  if (recipient) {
    const delivery = await deliverShareInvitations(
      env,
      [{ email: recipient, name: invoice.customerName, token }],
      {
        subject: `Invoice ${invoice.reference}`,
        body: input.message?.trim()
          || `Invoice ${invoice.reference} for ${formatMoney(amount, invoice.currency)} is ready. Payment is due ${dueAt.toISOString().slice(0, 10)}.`,
        actionLabel: paymentLinkUrl ? 'View and pay' : 'View the invoice',
        footnote: `Due ${dueAt.toISOString().slice(0, 10)}.`,
        linkFor: () => documentUrl,
      },
      'application/finance/receivables.ts',
    );

    if (delivery.sent > 0) {
      deliveredTo = recipient;
      await db
        .update(invoices)
        .set({ sentTo: recipient.slice(0, 320), sentAt: new Date(), updatedAt: new Date() })
        .where(scopedToTenant(invoices, tenantId, eq(invoices.id, invoice.id)));
    }
  }

  await invalidateAccountHistory(env, tenantId, invoice.customerRef);
  await recordActivity(env, db, {
    tenantId,
    actor: { type: 'human', ref: input.issuedBy, name: input.issuedBy },
    verb: 'invoice.issued',
    targetType: 'invoice',
    targetId: invoice.reference,
    targetLabel: `${invoice.reference} — ${invoice.customerName}`,
    summary: `Issued ${formatMoney(amount, invoice.currency)}, due ${dueAt.toISOString().slice(0, 10)}${deliveredTo ? `, sent to ${deliveredTo}` : ''}.`,
    ...(invoice.objectId ? { objectId: invoice.objectId } : {}),
  });

  const lineTotal = await documentLineTotal(db, tenantId, 'invoice', invoice.reference);
  return {
    reference: invoice.reference,
    status: 'issued',
    issuedAtISO: now.toISOString(),
    dueAtISO: dueAt.toISOString(),
    documentUrl,
    paymentLinkUrl: paymentLinkUrl?.url ?? null,
    deliveredTo,
    // Reported when the lines and the agreed total disagree — the schema's own
    // rule is that `amount` is what was AGREED and the lines are checked against
    // it, so a mismatch is reportable rather than invisible. Zero lines is not a
    // mismatch: plenty of invoices are a single agreed figure.
    lineTotalMismatch: lineTotal > 0 && Math.abs(lineTotal - amount) >= 0.01 ? lineTotal : null,
  };
}

/** The customer's address for the document. `/invoice/<ref>?t=<token>` rather than
 *  a bare token path, so a link pasted into a thread still says what it is. */
function invoiceDocumentUrl(env: Env, reference: string, token: string): string {
  return `${resolveAppBaseUrl(env)}/invoice/${encodeURIComponent(reference)}?t=${encodeURIComponent(token)}`;
}

/**
 * The hosted page the customer pays on, when the workspace can take a card.
 *
 * Returns null — never throws — when there is no chargeable merchant account.
 * Issuing must not fail because the tenant has not onboarded a processor: an
 * invoice paid by bank transfer is the ordinary case and the one every workspace
 * has on day one. A processor error DOES surface, because that is a link the
 * tenant expected and did not get.
 */
async function mintPaymentLink(
  db: Db,
  env: Env,
  tenantId: number,
  input: { reference: string; customerName: string; amountCents: number; currency: string; billingEmail: string | null; documentUrl: string },
): Promise<{ url: string; sessionId: string } | null> {
  const merchantAccountId = await chargeableMerchantId(db, tenantId);
  if (!merchantAccountId) return null;

  const session = await buildPaymentProvider(env).createInvoicePaymentLink({
    merchantAccountId,
    amountCents: input.amountCents,
    currency: input.currency,
    productName: `Invoice ${input.reference}`,
    billingEmail: input.billingEmail,
    // Both ends return to the document, which is the page that knows what to say
    // about either outcome — and the only page the customer can reach at all.
    successUrl: `${input.documentUrl}&paid={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${input.documentUrl}&paid=cancelled`,
    metadata: {
      purchaseKind: 'tenant_invoice',
      invoiceRef: input.reference,
      invoiceTenantId: String(tenantId),
    },
    // Same key for the same invoice, so a re-issue after a delivery failure does
    // not mint a second link against the same document.
    idempotencyKey: `ar-invoice:${tenantId}:${input.reference}`,
  });
  return { url: session.checkoutUrl, sessionId: session.sessionId };
}

/**
 * The activity actor for a caller that may be a person or the sweep.
 *
 * One helper rather than the same ternary at both call sites: `system` and a user
 * differ in TWO fields (`type` and `ref`), and a copy that updated one of them is
 * the shape of drift that produces an audit row attributing a cron sweep to a
 * person.
 */
const ACTOR = (actorRef: string): { type: 'system' | 'human'; ref: string | null; name: string } =>
  actorRef === 'system'
    ? { type: 'system', ref: null, name: 'Collections sweep' }
    : { type: 'human', ref: actorRef, name: actorRef };

const formatMoney = (amount: number, currency: string): string => {
  try {
    return amount.toLocaleString('en-US', { style: 'currency', currency });
  } catch {
    // An unrecognised ISO code must not throw inside an email subject.
    return `${amount.toFixed(2)} ${currency}`;
  }
};

// ---------------------------------------------------------------------------
// Act 2 — record a payment
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  reference: string;
  amount: number;
  /**
   * The IDEMPOTENCY key, and the whole reason a replay is harmless.
   *
   * A processor's payment intent id for a card payment; a bank reference for a
   * transfer; a caller-supplied string for anything else. It becomes the unique
   * `ledger_entries.reference`, so the same payment recorded twice — by a retried
   * webhook, a double-clicked button, or a person and a webhook racing — collides
   * in the database.
   */
  externalRef: string;
  /** 'card' | 'bank' | 'cash' | 'other'. What it says on the statement. */
  method?: string;
  paidAt?: string | null;
  memo?: string | null;
  /** Who recorded it, or 'system' for the webhook. */
  actorRef: string;
}

export interface RecordPaymentResult {
  reference: string;
  status: string;
  paidAmount: number;
  outstanding: number;
  /** False when this exact payment had already been recorded. The honest answer
   *  to a replay: nothing happened, and nothing was wrong. */
  applied: boolean;
}

/**
 * Record money that arrived against an invoice.
 *
 * ── IDEMPOTENCY IS THE DESIGN ────────────────────────────────────────────────
 * The ledger row is written FIRST and its unique `(tenant, denomination,
 * reference)` index is the gate. If the insert returns nothing, this payment has
 * already been applied and the function returns `applied: false` without touching
 * the invoice. Nothing depends on a caller remembering to check, which matters
 * because two of the three callers are a webhook and a redirect — i.e. exactly
 * the paths that arrive twice.
 *
 * ── WHY `paidAmount` IS RECOMPUTED FROM THE LEDGER ──────────────────────────
 * Rather than incremented. An increment is correct only if every prior write
 * happened exactly once, which is the property being defended — so the total is
 * summed from the rows that exist, and the invoice column is a materialised view
 * of them. A payment recorded, refunded and re-recorded therefore lands on the
 * right number without anybody reasoning about the order.
 */
export async function recordInvoicePayment(
  db: Db,
  env: Env,
  tenantId: number,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const invoice = await requireInvoice(db, tenantId, input.reference);
  if (!(PAYABLE_STATUSES as readonly string[]).includes(invoice.status)) {
    throw new ReceivableError(
      `Invoice ${invoice.reference} is "${invoice.status}". Money can only be recorded against an invoice that has been issued and is not already settled — if this is a real payment, it belongs to a different invoice or is an overpayment to refund.`,
      409,
    );
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ReceivableError('A payment needs a positive amount.', 400);
  }
  const externalRef = input.externalRef.trim().slice(0, 120);
  if (!externalRef) {
    throw new ReceivableError('A payment needs its own reference — a payment with no reference cannot be told apart from the same payment arriving twice.', 400);
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new ReceivableError('paidAt is not a date.', 400);

  const denomination = denominationFor(invoice.currency);
  const [written] = await db
    .insert(ledgerEntries)
    .values({
      tenantId,
      accountKind: 'tenant',
      accountRef: String(tenantId),
      denomination,
      amount: String(toCents(input.amount)),
      // A new VALUE in an existing column, which is what "denomination is a
      // column" buys: money coming IN from a customer is a new shape of movement,
      // not a new table.
      entryKind: 'receipt',
      reference: `ar-receipt:${invoice.reference}:${externalRef}`,
      memo: input.memo?.slice(0, 500) ?? `Payment for invoice ${invoice.reference}`,
      metadata: {
        source: 'receivable',
        invoiceRef: invoice.reference,
        method: input.method ?? 'other',
        recordedBy: input.actorRef,
      },
      occurredAt: paidAt,
      ...(invoice.objectId ? { objectId: invoice.objectId } : {}),
    })
    .onConflictDoNothing({ target: [ledgerEntries.tenantId, ledgerEntries.denomination, ledgerEntries.reference] })
    .returning({ id: ledgerEntries.id });

  if (!written) {
    return {
      reference: invoice.reference,
      status: invoice.status,
      paidAmount: Number(invoice.paidAmount),
      outstanding: Number(invoice.amount) - Number(invoice.paidAmount),
      applied: false,
    };
  }

  const paidAmount = await receiptTotal(db, tenantId, invoice.reference, denomination);
  const amount = Number(invoice.amount);
  // A tolerance of half a cent, because the total is summed from integer minor
  // units and the header is a decimal: an exactly-paid invoice must not stay
  // `part-paid` forever because of a representation difference.
  const settled = paidAmount + 0.005 >= amount;
  const status = settled ? 'paid' : 'part-paid';

  await db
    .update(invoices)
    .set({
      paidAmount: String(paidAmount),
      status,
      paidAt: settled ? paidAt : null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(invoices, tenantId, eq(invoices.id, invoice.id)));

  await invalidateAccountHistory(env, tenantId, invoice.customerRef);
  await recordActivity(env, db, {
    tenantId,
    actor: ACTOR(input.actorRef),
    verb: 'invoice.payment_recorded',
    targetType: 'invoice',
    targetId: invoice.reference,
    targetLabel: `${invoice.reference} — ${invoice.customerName}`,
    summary: settled
      ? `Paid in full — ${formatMoney(paidAmount, invoice.currency)}.`
      : `${formatMoney(paidAmount, invoice.currency)} of ${formatMoney(amount, invoice.currency)} received.`,
    ...(invoice.objectId ? { objectId: invoice.objectId } : {}),
  });

  return { reference: invoice.reference, status, paidAmount, outstanding: Math.max(0, amount - paidAmount), applied: true };
}

/** What the ledger says has landed on one invoice, in major units. One indexed
 *  aggregate rather than a page of rows — the sum is the only thing needed. */
async function receiptTotal(db: Db, tenantId: number, reference: string, denomination: string): Promise<number> {
  const [row] = await db
    .select({ cents: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(scopedToTenant(ledgerEntries, tenantId, and(
      eq(ledgerEntries.denomination, denomination),
      inArray(ledgerEntries.entryKind, ['receipt', 'refund']),
      sql`${ledgerEntries.metadata} ->> 'invoiceRef' = ${reference}`,
    )));
  return Number(row?.cents ?? 0) / 100;
}

/**
 * Settle a payment the CUSTOMER made on the hosted page (FO-C4).
 *
 * Everything that authorises it is read back from the processor: that the session
 * was paid, what it was for, and — the check a naive implementation forgets — that
 * the invoice it names is the one whose tenant created it. Without that last one, a
 * session id from any tenant's checkout would settle any other tenant's invoice.
 * Same discipline `completeListingCheckout` states, applied to a receivable.
 *
 * The payment intent id becomes the idempotency reference, so the redirect and the
 * webhook — which both arrive, in either order — land on one ledger row.
 */
export async function settleInvoiceCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; invoiceRef: string; checkoutSessionId: string },
): Promise<RecordPaymentResult> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: 'tenant_invoice',
    owner: { invoiceRef: input.invoiceRef, invoiceTenantId: input.tenantId },
    messages: {
      notConfigured: 'Card payments are not configured on this deployment.',
      notFound: 'That payment could not be found at the processor.',
      notPaid: 'That payment has not completed.',
      wrongKind: 'That payment was not for an invoice.',
      notYours: 'That payment belongs to a different invoice.',
    },
    refuse: (message, status) => new ReceivableError(message, status),
  });

  return recordInvoicePayment(db, env, input.tenantId, {
    reference: input.invoiceRef,
    amount: verified.amountCents / 100,
    externalRef: verified.paymentRef,
    method: 'card',
    memo: `Card payment for invoice ${input.invoiceRef}`,
    actorRef: 'system',
  });
}

// ---------------------------------------------------------------------------
// Act 3 — chase
// ---------------------------------------------------------------------------

export interface ChaseResult {
  reference: string;
  step: number;
  stepLabel: string;
  outcome: string;
  /** False when this rung had already been climbed. */
  recorded: boolean;
  deliveredTo: string | null;
}

/**
 * Climb one rung of the collections ladder.
 *
 * ── ONE FUNCTION FOR BOTH CLIMBERS ──────────────────────────────────────────
 * A person clicking "chase" and the sweep finding a rung due both come through
 * here, so there is one collections history rather than two that disagree about
 * what the customer has actually been sent. The sweep passes `actorRef: 'system'`
 * and nothing else differs.
 *
 * ── THE UNIQUE INDEX IS THE CONTROL ─────────────────────────────────────────
 * `(tenant, invoice_ref, step)` is unique, so a rung is climbed once. That is what
 * makes the sweep safe to run twice in a day and safe to force-run from the
 * operator control: a second attempt returns `recorded: false` instead of sending
 * the same customer the same reminder again. An already-recorded PENDING rung is
 * upgraded to `sent` — which is the "I have now actually done the thing the
 * worklist told me was due" case, and the only reason a re-climb is not simply a
 * no-op.
 */
export async function chaseInvoice(
  db: Db,
  env: Env,
  tenantId: number,
  input: {
    reference: string;
    step: number;
    stepLabel: string;
    /** 'email' reaches the customer; 'internal' is a worklist entry for us. */
    channel: 'email' | 'internal';
    /**
     * Whether anything actually leaves the building.
     *
     * Explicit, and never inferred from the presence of an address, because the
     * two cases differ by INTENT rather than by data: a workspace on `notify` has
     * a perfectly good customer address on file and has asked us not to use it.
     * A `deliverTo`-shaped switch would send to `sentTo` the moment a caller
     * omitted the field, which is precisely the accident this is a boolean to
     * prevent.
     */
    deliver: boolean;
    /** Where to send it, when `deliver`. Falls back to the address the invoice
     *  was issued to. */
    deliverTo?: string | null;
    subject?: string | null;
    body?: string | null;
    detail?: string | null;
    actorRef: string;
  },
): Promise<ChaseResult> {
  const invoice = await requireInvoice(db, tenantId, input.reference);
  if (!(PAYABLE_STATUSES as readonly string[]).includes(invoice.status)) {
    throw new ReceivableError(
      `Invoice ${invoice.reference} is "${invoice.status}" — there is nothing outstanding to chase.`,
      409,
    );
  }

  const step = Math.max(0, Math.round(input.step));
  const [claimed] = await db
    .insert(collectionActions)
    .values({
      tenantId,
      invoiceRef: invoice.reference,
      step,
      stepLabel: input.stepLabel.slice(0, 64),
      channel: input.channel,
      outcome: 'pending',
      detail: input.detail ?? null,
      actorRef: input.actorRef.slice(0, 64),
    })
    .onConflictDoNothing({ target: [collectionActions.tenantId, collectionActions.invoiceRef, collectionActions.step] })
    .returning({ id: collectionActions.id });

  // The rung was already recorded. Only a PENDING one may be climbed again — that
  // is a person doing the work the worklist said was due, not a second reminder.
  let actionId = claimed?.id ?? null;
  if (!actionId) {
    const [existing] = await db
      .select({ id: collectionActions.id, outcome: collectionActions.outcome, stepLabel: collectionActions.stepLabel })
      .from(collectionActions)
      .where(scopedToTenant(collectionActions, tenantId, and(
        eq(collectionActions.invoiceRef, invoice.reference),
        eq(collectionActions.step, step),
      )))
      .limit(1);
    if (!existing || existing.outcome !== 'pending') {
      return {
        reference: invoice.reference,
        step,
        stepLabel: existing?.stepLabel ?? input.stepLabel,
        outcome: existing?.outcome ?? 'sent',
        recorded: false,
        deliveredTo: null,
      };
    }
    actionId = existing.id;
  }

  const recipient = input.deliver && input.channel === 'email'
    ? input.deliverTo?.trim() || invoice.sentTo
    : null;
  let deliveredTo: string | null = null;
  let outcome: 'pending' | 'sent' | 'failed' = 'pending';

  if (recipient) {
    const outstanding = Number(invoice.amount) - Number(invoice.paidAmount);
    const delivery = await deliverShareInvitations(
      env,
      // No token: a chase carries the PAYMENT link, which the processor already
      // minted and which needs no credential of ours. Re-issuing the document
      // token here would invalidate the link the customer was originally sent —
      // the opposite of what a reminder is for.
      [{ email: recipient, name: invoice.customerName, token: '' }],
      {
        subject: (input.subject?.trim() || `Invoice ${invoice.reference} — ${input.stepLabel}`).slice(0, 120),
        body: input.body?.trim()
          || `${formatMoney(outstanding, invoice.currency)} is outstanding on invoice ${invoice.reference}${invoice.dueAt ? `, which was due ${invoice.dueAt.toISOString().slice(0, 10)}` : ''}.`,
        actionLabel: invoice.paymentLinkUrl ? 'View and pay' : 'View the invoice',
        // Chasing somebody with a link they have to go and find is the failure
        // `runSignatureReminderSweep` names.
        linkFor: () => invoice.paymentLinkUrl ?? `${resolveAppBaseUrl(env)}/invoice/${encodeURIComponent(invoice.reference)}`,
      },
      'application/finance/receivables.ts',
    );
    deliveredTo = delivery.sent > 0 ? recipient : null;
    outcome = delivery.sent > 0 ? 'sent' : 'failed';
  } else if (input.deliver && input.channel === 'internal') {
    // An internal rung has nothing to deliver: recording it IS the act.
    outcome = 'sent';
  }
  // Everything else stays `pending` — the rung is DUE and nothing has been sent,
  // which is a worklist item rather than a claim. That is the whole of `notify`.

  await db
    .update(collectionActions)
    .set({ outcome, actedAt: new Date(), ...(deliveredTo ? { detail: `${input.detail ? `${input.detail} — ` : ''}sent to ${deliveredTo}` } : {}) })
    .where(scopedToTenant(collectionActions, tenantId, eq(collectionActions.id, actionId)));

  await recordActivity(env, db, {
    tenantId,
    actor: ACTOR(input.actorRef),
    verb: 'invoice.chased',
    targetType: 'invoice',
    targetId: invoice.reference,
    targetLabel: `${invoice.reference} — ${invoice.customerName}`,
    summary: outcome === 'sent' && deliveredTo
      ? `${input.stepLabel} sent to ${deliveredTo}.`
      : outcome === 'failed'
        ? `${input.stepLabel} could not be delivered to ${recipient ?? 'the customer'}.`
        : input.deliver
          ? `${input.stepLabel} is due — no recipient on file, so nothing was sent.`
          : `${input.stepLabel} is due. Nothing has been sent: this workspace chases on review.`,
    ...(invoice.objectId ? { objectId: invoice.objectId } : {}),
  });

  return { reference: invoice.reference, step, stepLabel: input.stepLabel, outcome, recorded: true, deliveredTo };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What has actually been done to collect one invoice — the record
 *  `invoice.collection`'s hint says must exist. Oldest rung first, because a
 *  ladder reads upward. */
export async function collectionLog(db: Db, tenantId: number, reference: string) {
  return db
    .select({
      step: collectionActions.step,
      stepLabel: collectionActions.stepLabel,
      channel: collectionActions.channel,
      outcome: collectionActions.outcome,
      detail: collectionActions.detail,
      actorRef: collectionActions.actorRef,
      actedAt: collectionActions.actedAt,
    })
    .from(collectionActions)
    .where(scopedToTenant(collectionActions, tenantId, eq(collectionActions.invoiceRef, reference.trim().slice(0, 64))))
    .orderBy(asc(collectionActions.step))
    .limit(PAGE);
}

/** Every rung recorded but not yet done — the workspace's collections worklist.
 *  This is what `notify` mode produces, and the reason it is a mode rather than
 *  "off with extra steps". */
export async function collectionWorklist(db: Db, tenantId: number) {
  return db
    .select({
      invoiceRef: collectionActions.invoiceRef,
      step: collectionActions.step,
      stepLabel: collectionActions.stepLabel,
      channel: collectionActions.channel,
      actedAt: collectionActions.actedAt,
      customerName: invoices.customerName,
      amount: invoices.amount,
      paidAmount: invoices.paidAmount,
      currency: invoices.currency,
      dueAt: invoices.dueAt,
    })
    .from(collectionActions)
    .innerJoin(invoices, and(eq(invoices.tenantId, collectionActions.tenantId), eq(invoices.reference, collectionActions.invoiceRef)))
    .where(scopedToTenant(collectionActions, tenantId, eq(collectionActions.outcome, 'pending')))
    .orderBy(asc(invoices.dueAt))
    .limit(PAGE);
}

export interface PublicInvoiceDocument {
  reference: string;
  customerName: string;
  currency: string;
  status: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  issuedAtISO: string | null;
  dueAtISO: string | null;
  ageingDays: number;
  notes: string | null;
  paymentLinkUrl: string | null;
  lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number }>;
}

/**
 * The document, resolved by the CUSTOMER's token.
 *
 * `acrossTenants` with the `share_token` reason, exactly as the signature parties
 * and published forms do: the presenter has no session and therefore no tenant, so
 * the credential is what establishes which tenant's row this is. The token is
 * hashed before the lookup and the hash column is uniquely indexed, so the read is
 * one index hit and a wrong token finds nothing rather than the wrong invoice.
 */
export async function invoiceByToken(db: Db, token: string): Promise<{ tenantId: number; document: PublicInvoiceDocument } | null> {
  const clean = token.trim();
  if (!clean) return null;
  const tokenHash = await hashShareToken(clean);
  const [row] = await db
    .select({
      tenantId: invoices.tenantId,
      reference: invoices.reference,
      customerName: invoices.customerName,
      currency: invoices.currency,
      status: invoices.status,
      amount: invoices.amount,
      paidAmount: invoices.paidAmount,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      notes: invoices.notes,
      paymentLinkUrl: invoices.paymentLinkUrl,
    })
    .from(invoices)
    .where(acrossTenants(invoices, 'share_token', eq(invoices.documentTokenHash, tokenHash)))
    .limit(1);
  if (!row) return null;

  const lines = await db
    .select({
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitAmount: invoiceLineItems.unitAmount,
      amount: invoiceLineItems.amount,
    })
    .from(invoiceLineItems)
    .where(scopedToTenant(invoiceLineItems, row.tenantId, and(
      eq(invoiceLineItems.documentKind, 'invoice'),
      eq(invoiceLineItems.invoiceRef, row.reference),
    )))
    .orderBy(asc(invoiceLineItems.position))
    .limit(PAGE);

  const amount = Number(row.amount);
  const paidAmount = Number(row.paidAmount);
  return {
    tenantId: row.tenantId,
    document: {
      reference: row.reference,
      customerName: row.customerName,
      currency: row.currency,
      status: row.status,
      amount,
      paidAmount,
      outstanding: Math.max(0, amount - paidAmount),
      issuedAtISO: row.issuedAt ? row.issuedAt.toISOString() : null,
      dueAtISO: row.dueAt ? row.dueAt.toISOString() : null,
      ageingDays: ageingDays(row.dueAt),
      notes: row.notes,
      // Only offered while there is something to pay. A paid invoice still
      // rendering a live checkout button is how a customer pays twice.
      paymentLinkUrl: amount - paidAmount > 0 ? row.paymentLinkUrl : null,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitAmount: Number(line.unitAmount),
        amount: Number(line.amount),
      })),
    },
  };
}

/**
 * Days past due — THE derivation `ageingDays` was documented as having and did not.
 *
 * Exported and computed rather than stored, because the field's own hint says "never
 * authored, because a stale ageing is worse than none" and a stored column would be
 * exactly that stale value one day later. Negative means not yet due; the canvas
 * projection clamps it at zero, because "minus four days overdue" is not a sentence.
 */
export function ageingDays(dueAt: Date | null, now = Date.now()): number {
  if (!dueAt) return 0;
  return Math.floor((now - dueAt.getTime()) / 86_400_000);
}

/** The receivables one surface needs at once: the ledger plus each one's ageing,
 *  so a caller never fans out a second query per row. */
export async function openReceivables(db: Db, tenantId: number, now = Date.now()) {
  const rows = await db
    .select({
      reference: invoices.reference,
      customerName: invoices.customerName,
      customerRef: invoices.customerRef,
      amount: invoices.amount,
      paidAmount: invoices.paidAmount,
      currency: invoices.currency,
      status: invoices.status,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      collectionMode: invoices.collectionMode,
      paymentLinkUrl: invoices.paymentLinkUrl,
      sentTo: invoices.sentTo,
    })
    .from(invoices)
    .where(scopedToTenant(invoices, tenantId, inArray(invoices.status, [...PAYABLE_STATUSES])))
    .orderBy(asc(invoices.dueAt), desc(invoices.updatedAt))
    .limit(PAGE);

  return rows.map((row) => ({
    reference: row.reference,
    customerName: row.customerName,
    customerRef: row.customerRef,
    amount: Number(row.amount),
    paidAmount: Number(row.paidAmount),
    outstanding: Number(row.amount) - Number(row.paidAmount),
    currency: row.currency,
    status: row.status,
    issuedAtISO: row.issuedAt ? row.issuedAt.toISOString() : null,
    dueAtISO: row.dueAt ? row.dueAt.toISOString() : null,
    ageingDays: Math.max(0, ageingDays(row.dueAt, now)),
    collectionMode: row.collectionMode,
    hasPaymentLink: Boolean(row.paymentLinkUrl),
    sentTo: row.sentTo,
  }));
}
