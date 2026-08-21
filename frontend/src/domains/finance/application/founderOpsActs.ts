/**
 * FOUNDER OPERATIONS, as card acts — the receivable, the payroll run and the
 * update that goes to the people who funded it.
 *
 * ── WHY THESE ARE HERE AND NOT IN THE CANVAS ─────────────────────────────────
 * PRD 22 §3.4 names them: `runInvoiceAction`, `syncPayRunCard` and
 * `sendUpdateToInvestors` were implemented inside `CanvasInner`, and none of the
 * five bounded contexts the canvas map declares owns any of them. They are
 * finance. The canvas owns the SHAPE of an act (`domains/canvas/application/
 * CardAct.ts`) and the board it runs against; what "issue an invoice" MEANS is
 * this context's, and it can now be asserted without a React tree.
 *
 * The transports stay in `lib/founderOpsApi.ts`. That is the seam this layer is
 * allowed to depend on and the one every other finance surface already calls —
 * a second client for the same endpoints is how the board and the ledger start
 * disagreeing about what was issued.
 */

import {
  chaseInvoice,
  draftInvoice,
  issueInvoice,
  listPayRuns,
  payRunLines,
  recordInvoicePayment,
  sendInvestorUpdate,
  syncPayRuns,
} from '@/lib/founderOpsApi';
import { payRunFieldsFrom } from '@/lib/canvasFounderOpsTools';
import { cardRows, cardText, type CardAct, type CardActOutcome } from '@/domains/canvas/application/CardAct';

/**
 * `investorUpdate.send`, with a delivery behind it.
 *
 * Recipients come from the object's own `recipients` rows and from NOWHERE else.
 * Harvesting addresses out of a `fundingRound`'s investor table would be the
 * convenient version and the wrong one: those rows carry firm names, not consent
 * to be emailed, and the failure mode of guessing is a private update reaching a
 * stranger. An update with no recipients says so and sends nothing.
 */
export const sendInvestorUpdateAct: CardAct = {
  kind: 'investorUpdate' as CardAct['kind'],
  actions: ['send'],
  accountRequired: 'noticeInvestorUpdateNeedsAccount',
  failureNotice: 'noticeInvestorUpdateFailed',
  async run({ object, t }) {
    const data = object.data as Record<string, unknown>;
    const recipients = cardRows(data, 'recipients').flatMap((row) => {
      const email = cardText(row, 'email');
      return email.includes('@') ? [{ email, name: typeof row.name === 'string' ? row.name : null }] : [];
    });
    if (!recipients.length) return { notice: t('noticeInvestorUpdateNoRecipients') };

    const result = await sendInvestorUpdate({
      content: {
        title: object.data.title,
        period: data.period ?? null,
        highlights: data.highlights ?? [],
        lowlights: data.lowlights ?? [],
        metrics: data.metrics ?? [],
        asks: data.asks ?? [],
        summary: data.summary ?? null,
      },
      recipients,
      objectId: null,
    });
    return {
      // Stamped onto the card, so "did this go out, and to how many" survives the
      // notice being dismissed.
      patch: { status: `Sent to ${result.sent}`, sentAt: new Date().toISOString() },
      notice: result.failed.length
        ? t('noticeInvestorUpdatePartial', { sent: result.sent, failed: result.failed.length })
        : t('noticeInvestorUpdateSent', { sent: result.sent, from: result.fromLabel }),
    };
  },
};

/**
 * THE receivable's three acts (FO-C2).
 *
 * ── WHY THE CARD IS MATERIALISED FIRST ──────────────────────────────────────
 * A canvas `invoice` is authored, not created through a form, so the row it
 * refers to may not exist when somebody clicks Issue. `draftInvoice` upserts it
 * from the card's own fields keyed on the invoice number, and only then does the
 * act run. The ACT is what makes the record, so there is no window in which a
 * board shows an issued invoice that the ledger has never heard of.
 *
 * ── WHY THE RESULT IS STAMPED BACK ──────────────────────────────────────────
 * `issuedAt`, `dueAt`, `paymentLink` and `status` all come back from the server
 * and are written onto the card in the same turn. An act that ends at a toast
 * leaves no trace once the toast closes.
 */
export const invoiceAct: CardAct = {
  kind: 'invoice' as CardAct['kind'],
  actions: ['issue', 'record-payment', 'chase'],
  accountRequired: 'noticeInvoiceNeedsAccount',
  failureNotice: 'noticeInvoiceActionFailed',
  async run({ object, action, t }): Promise<CardActOutcome> {
    const data = object.data as Record<string, unknown>;
    const reference = cardText(data, 'invoiceNumber') || cardText(data, 'title');
    const customerName = cardText(data, 'customer') || cardText(data, 'counterpartyAccount');
    const amount = Number(data.amount);
    if (!reference || !customerName || !Number.isFinite(amount)) return { notice: t('noticeInvoiceIncomplete') };

    if (action === 'issue') {
      // Always re-drafted before issuing: the card is the authoring surface, and a
      // figure edited on it after the row was written must reach the row before
      // anything is frozen.
      await draftInvoice({
        reference,
        customerName,
        customerRef: cardText(data, 'counterpartyAccount') || null,
        amount,
        ...(cardText(data, 'currency') ? { currency: cardText(data, 'currency') } : {}),
        dueAt: cardText(data, 'dueAt') || null,
        notes: cardText(data, 'summary') || null,
        ...(cardText(data, 'collectionMode') ? { collectionMode: cardText(data, 'collectionMode') } : {}),
        lines: cardRows(data, 'lineItems').flatMap((line) => {
          const unitAmount = Number(line.unitPrice);
          if (!cardText(line, 'description') || !Number.isFinite(unitAmount)) return [];
          return [{
            description: cardText(line, 'description'),
            quantity: Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : 1,
            unitAmount,
            ...(Number.isFinite(Number(line.amount)) ? { amount: Number(line.amount) } : {}),
          }];
        }),
      });

      const issued = await issueInvoice(reference, {
        deliverTo: cardText(data, 'customerEmail') || null,
        dueAt: cardText(data, 'dueAt') || null,
      });
      return {
        patch: {
          status: 'issued',
          issuedAt: issued.issuedAtISO.slice(0, 10),
          ...(issued.dueAtISO ? { dueAt: issued.dueAtISO.slice(0, 10) } : {}),
          ...(issued.paymentLinkUrl ? { paymentLink: issued.paymentLinkUrl } : {}),
        },
        notice: issued.deliveredTo
          ? t('noticeInvoiceIssuedSent', { reference, to: issued.deliveredTo })
          : t('noticeInvoiceIssued', { reference }),
      };
    }

    if (action === 'record-payment') {
      const paid = Number(data.paidAmount);
      const outstanding = amount - (Number.isFinite(paid) ? paid : 0);
      if (!(outstanding > 0)) return { notice: t('noticeInvoiceNothingOutstanding') };
      const recorded = await recordInvoicePayment(reference, {
        amount: outstanding,
        // Stable per (invoice, amount), so a double-click is one payment — the
        // server's unique ledger reference is what actually enforces it.
        externalRef: `canvas:${reference}:${outstanding.toFixed(2)}`,
        method: 'bank',
      });
      return {
        patch: { status: recorded.status, paidAmount: recorded.paidAmount },
        notice: recorded.applied
          ? t('noticeInvoicePaymentRecorded', { reference, outstanding: recorded.outstanding })
          : t('noticeInvoicePaymentAlreadyRecorded', { reference }),
      };
    }

    const chased = await chaseInvoice(reference, { deliverTo: cardText(data, 'customerEmail') || null });
    return {
      notice: chased.deliveredTo
        ? t('noticeInvoiceChased', { reference, to: chased.deliveredTo })
        : t('noticeInvoiceChaseNoRecipient', { reference }),
    };
  },
};

/**
 * `payRun.sync` — re-read this card's run from the provider that ran it.
 *
 * ── WHY IT SHARES THE TOOL'S PROJECTION ─────────────────────────────────────
 * `payRunFieldsFrom` is exported by `canvasFounderOpsTools.ts` and called here,
 * so the card a person refreshes and the card Brain authors are the same card. A
 * second local mapping of `totalCost` → the board is how one of them starts
 * showing gross where the other shows total cost, which is a different number by
 * roughly the employer's tax bill.
 *
 * ── WHY IT REFUSES RATHER THAN GUESSES ──────────────────────────────────────
 * The card is matched on the provider's own `externalRef`. A card authored by
 * hand has none, and the honest answer there is to say so — inventing a match on
 * the date or the amount would silently overwrite one month's payroll with
 * another's.
 */
export const payRunSyncAct: CardAct = {
  kind: 'payRun' as CardAct['kind'],
  actions: ['sync'],
  accountRequired: 'noticePayRunNeedsAccount',
  failureNotice: 'noticePayRunFailed',
  async run({ object, t }) {
    const externalRef = cardText(object.data as Record<string, unknown>, 'externalRef');
    if (!externalRef) return { notice: t('noticePayRunNoReference') };

    const hydration = await syncPayRuns({});
    if (hydration.error) return { notice: hydration.error };
    if (!hydration.source) return { notice: t('noticePayRunNoProvider') };

    const run = (await listPayRuns()).find((candidate) => candidate.externalRef === externalRef);
    if (!run) return { notice: t('noticePayRunNotFound', { reference: externalRef }) };

    const lines = await payRunLines(run.reference).catch(() => []);
    return { patch: payRunFieldsFrom(run, lines), notice: t('noticePayRunSynced', { source: run.source }) };
  },
};

export const FOUNDER_OPS_CARD_ACTS: readonly CardAct[] = [sendInvestorUpdateAct, invoiceAct, payRunSyncAct];
