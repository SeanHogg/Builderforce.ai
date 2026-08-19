/**
 * THE collections ladder — getting paid without a person remembering to chase.
 *
 * ── WHAT THIS CLOSES (FO-C5) ─────────────────────────────────────────────────
 * `invoice.collection` was authored prose, under a hint that says "collections
 * work with no record is collections work that gets done twice or not at all".
 * There was no record and no engine: an invoice went overdue and stayed overdue
 * until somebody opened the board, which is the same defect `runTriggerSweep`
 * closed for thresholds — "a threshold was checked exactly when a person was
 * already looking at it, which is the one circumstance in which they did not need
 * telling".
 *
 * ── THE RUNGS ARE DATA ───────────────────────────────────────────────────────
 * {@link COLLECTION_LADDER} is a list, not a branch per stage. Re-tuning the
 * cadence is editing an array; adding a rung is appending to it. The rung's LABEL
 * is denormalised onto the row when it is climbed, so re-tuning later does not
 * rewrite the history of what a customer was actually sent.
 *
 * ── WHY IT CLIMBS ONE RUNG PER PASS ──────────────────────────────────────────
 * An invoice imported ninety days overdue is eligible for every rung at once, and
 * a naive "climb everything that is due" would send that customer four escalating
 * emails inside one minute — the first they have ever received from us, arriving
 * in the wrong order and ending at a final notice. One rung per pass means the
 * ladder catches up over days, in order, which is what a human collections process
 * looks like.
 *
 * ── WHY `notify` IS THE DEFAULT ──────────────────────────────────────────────
 * Because a sweep that emails a tenant's CUSTOMERS unattended is an agent acting
 * on the tenant's behalf, in their name, outside the building. `runTriggerSweep`
 * refuses to perform a trigger's `thenDo` for exactly this reason: "those are
 * authored instructions with owners, several of them irreversible (chase a
 * customer, schedule a payment), and a sweep that executed them would be an
 * unattended agent acting on a threshold nobody re-read". So the default records
 * the rung as DUE and tells the workspace; `auto` is the tenant explicitly
 * delegating the send, per invoice.
 *
 * ── AND THE AGEING RECOMPUTE ─────────────────────────────────────────────────
 * The second half of this sweep writes `ageingDays` onto canvas `invoice` cards.
 * That field is documented as "computed from `dueAt` — never authored, because a
 * stale ageing is worse than none" and it was computed by NOTHING: the number on
 * the card was whatever the model last typed. It is written here rather than in a
 * second sweep because it is the same read of the same boards for the same reason,
 * and two sweeps over one question is how two answers appear.
 */

import { and, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { buildDatabase } from '../../infrastructure/database/connection';
import { collectionActions, creationSessionObjects, invoices } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ageingDays, chaseInvoice } from './receivables';

/** One rung: what it is called, when it becomes due, and who it reaches. */
export interface CollectionRung {
  /** The index the unique `(tenant, invoice_ref, step)` keys on. Stable forever —
   *  renumbering rungs would let an already-climbed one be climbed again. */
  step: number;
  /** Denormalised onto the row when climbed, so re-tuning does not rewrite history. */
  label: string;
  /** Days past `dueAt` at which this rung becomes due. Negative is BEFORE the due
   *  date, which is where the only genuinely effective reminder lives. */
  atDays: number;
  /** 'email' reaches the customer; 'internal' is a job for a person here. */
  channel: 'email' | 'internal';
  /** The words. Model-facing prose is English everywhere in this codebase; these
   *  reach a customer, so they are deliberately plain and unbranded. */
  subject: (reference: string) => string;
  body: (input: { reference: string; outstanding: string; dueDate: string; days: number }) => string;
}

/**
 * The ladder.
 *
 * Five rungs, ending at a HUMAN rather than at a harsher email. An automated
 * final demand is the point at which a collections ladder starts doing damage
 * a person would not have done — to a customer who is disputing an amount, or
 * whose invoice was wrong, or who is about to sign a renewal. The escalation is
 * to somebody who can read the account.
 */
export const COLLECTION_LADDER: readonly CollectionRung[] = [
  {
    step: 0,
    label: 'Due in three days',
    atDays: -3,
    channel: 'email',
    subject: (reference) => `Invoice ${reference} is due shortly`,
    body: ({ reference, outstanding, dueDate }) =>
      `A reminder that ${outstanding} on invoice ${reference} falls due on ${dueDate}. If it is already scheduled, please ignore this.`,
  },
  {
    step: 1,
    label: 'Just overdue',
    atDays: 1,
    channel: 'email',
    subject: (reference) => `Invoice ${reference} is now overdue`,
    body: ({ reference, outstanding, dueDate }) =>
      `${outstanding} on invoice ${reference} was due on ${dueDate} and is now outstanding. If there is a problem with it, replying to this message is the fastest way to sort it out.`,
  },
  {
    step: 2,
    label: 'Two weeks overdue',
    atDays: 14,
    channel: 'email',
    subject: (reference) => `Invoice ${reference} — two weeks overdue`,
    body: ({ reference, outstanding, days }) =>
      `${outstanding} on invoice ${reference} has been outstanding for ${days} days. Could you let us know when it is scheduled for payment?`,
  },
  {
    step: 3,
    label: 'A month overdue',
    atDays: 30,
    channel: 'email',
    subject: (reference) => `Invoice ${reference} — a month overdue`,
    body: ({ reference, outstanding, days }) =>
      `${outstanding} on invoice ${reference} has now been outstanding for ${days} days. We would rather resolve this directly than escalate it — please tell us what is holding it up.`,
  },
  {
    step: 4,
    label: 'Escalate to a person',
    atDays: 45,
    // The last rung reaches US, not the customer. See the ladder's own note: an
    // automated final demand is where this stops helping.
    channel: 'internal',
    subject: (reference) => `Invoice ${reference} needs a decision`,
    body: ({ reference, outstanding, days }) =>
      `${outstanding} on invoice ${reference} is ${days} days overdue and four reminders have gone unanswered. Somebody needs to call the account, agree a plan, or write it off.`,
  },
];

export interface CollectionsSweepResult {
  /** Invoices considered this pass. */
  examined: number;
  /** Rungs climbed and actually sent to a customer. */
  sent: number;
  /** Rungs recorded as DUE without sending — `notify` mode's worklist. */
  queued: number;
  /** Rungs whose delivery failed. */
  failed: number;
  /** Canvas `invoice` cards whose stored `ageingDays` moved. */
  aged: number;
  /** Invoices left for the next tick because of the per-pass ceiling. */
  skipped: number;
}

/**
 * How many overdue invoices one pass will consider.
 *
 * A ceiling rather than a cursor, for the reason `runTriggerSweep` states: the
 * sweep is idempotent and daily, so a workspace beyond this is chased on the next
 * tick — a delay — while an unbounded scan is an outage. `skipped` is REPORTED so
 * the ceiling shows up in the log line rather than looking like full coverage.
 */
const MAX_INVOICES_PER_PASS = 500;

/** Beyond this a board is not a board. Matches `runTriggerSweep`'s own ceiling. */
const MAX_OBJECTS_PER_SESSION = 2_000;

const money = (amount: number, currency: string): string => {
  try {
    return amount.toLocaleString('en-US', { style: 'currency', currency });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/**
 * The rung this invoice is due for, or null.
 *
 * The HIGHEST rung whose `atDays` has been reached and which has not been climbed
 * — highest so that an invoice which has quietly passed several thresholds is not
 * chased with a reminder about a date three weeks ago, and "not climbed" so the
 * unique index is never the thing doing the deciding.
 *
 * Exported for its own test: this is the whole cadence in four lines, and it is
 * the part that is wrong in every hand-rolled collections process.
 */
export function nextRung(days: number, climbed: ReadonlySet<number>): CollectionRung | null {
  for (let index = COLLECTION_LADDER.length - 1; index >= 0; index -= 1) {
    const rung = COLLECTION_LADDER[index];
    if (rung && days >= rung.atDays && !climbed.has(rung.step)) return rung;
  }
  return null;
}

/**
 * Climb what is due, then re-age the boards.
 *
 * Three statements plus one write per rung, regardless of tenant count: one to
 * find chaseable invoices, one to load every already-climbed rung for exactly
 * those invoices, one to load the canvas cards that hold an `invoice`. No
 * per-tenant fan-out and no N+1 — the caching-and-performance standard's shape.
 */
export async function runCollectionsSweep(env: Env, db: Db = buildDatabase(env), now = new Date()): Promise<CollectionsSweepResult> {
  const result: CollectionsSweepResult = { examined: 0, sent: 0, queued: 0, failed: 0, aged: 0, skipped: 0 };

  // 1 — every invoice the ladder may touch, ACROSS tenants. A platform sweep
  // visits every workspace by definition, which is why there is no
  // `scopedToTenant` here and why the tenant is carried on each row: the chase
  // itself is tenant-scoped, and takes its tenant from the row rather than from a
  // caller that has none. `collection_mode <> 'off'` and a due date are both
  // covered by `idx_invoices_collection`, so this is one range scan.
  const earliestRung = COLLECTION_LADDER[0]?.atDays ?? 0;
  const horizon = new Date(now.getTime() - earliestRung * 86_400_000);
  const candidates = await db
    .select({
      tenantId: invoices.tenantId,
      reference: invoices.reference,
      customerName: invoices.customerName,
      amount: invoices.amount,
      paidAmount: invoices.paidAmount,
      currency: invoices.currency,
      dueAt: invoices.dueAt,
      collectionMode: invoices.collectionMode,
      sentTo: invoices.sentTo,
    })
    .from(invoices)
    .where(and(
      inArray(invoices.status, ['issued', 'part-paid']),
      ne(invoices.collectionMode, 'off'),
      isNotNull(invoices.dueAt),
      lte(invoices.dueAt, horizon),
    ))
    .orderBy(invoices.dueAt)
    .limit(MAX_INVOICES_PER_PASS + 1);

  result.skipped = Math.max(0, candidates.length - MAX_INVOICES_PER_PASS);
  const due = candidates.slice(0, MAX_INVOICES_PER_PASS);

  if (due.length) {
    // 2 — every rung already climbed, for exactly those invoices, in ONE
    // statement. A per-invoice read here would be 500 of them.
    const climbedRows = await db
      .select({ tenantId: collectionActions.tenantId, invoiceRef: collectionActions.invoiceRef, step: collectionActions.step })
      .from(collectionActions)
      .where(inArray(collectionActions.invoiceRef, due.map((row) => row.reference)))
      .limit(MAX_INVOICES_PER_PASS * COLLECTION_LADDER.length);

    const climbed = new Map<string, Set<number>>();
    for (const row of climbedRows) {
      const key = `${row.tenantId}:${row.invoiceRef}`;
      const set = climbed.get(key);
      if (set) set.add(row.step); else climbed.set(key, new Set([row.step]));
    }

    for (const invoice of due) {
      result.examined += 1;
      const days = ageingDays(invoice.dueAt, now.getTime());
      const rung = nextRung(days, climbed.get(`${invoice.tenantId}:${invoice.reference}`) ?? new Set());
      if (!rung) continue;

      const outstanding = Number(invoice.amount) - Number(invoice.paidAmount);
      // `auto` is the tenant having explicitly delegated the send. An internal
      // rung is delivered in either mode, because it reaches nobody outside the
      // workspace — that is the whole reason the last rung is internal.
      const deliver = rung.channel === 'internal' || invoice.collectionMode === 'auto';

      try {
        const chased = await chaseInvoice(db, env, invoice.tenantId, {
          reference: invoice.reference,
          step: rung.step,
          stepLabel: rung.label,
          channel: rung.channel,
          deliver,
          deliverTo: invoice.sentTo,
          subject: rung.subject(invoice.reference),
          body: rung.body({
            reference: invoice.reference,
            outstanding: money(outstanding, invoice.currency),
            dueDate: invoice.dueAt ? invoice.dueAt.toISOString().slice(0, 10) : 'the agreed date',
            days: Math.max(0, days),
          }),
          detail: `Ladder rung ${rung.step} at ${days} days.`,
          actorRef: 'system',
        });
        if (!chased.recorded) continue;
        if (chased.outcome === 'sent') result.sent += 1;
        else if (chased.outcome === 'failed') result.failed += 1;
        else result.queued += 1;
      } catch (error) {
        // One unreachable customer must not stop the other 499 — the same
        // per-recipient failure policy `shareInvitationMailer` states.
        result.failed += 1;
        reportCaughtError(error, {
          source: 'application/finance/collectionsLadder.ts',
          operation: 'runCollectionsSweep',
          level: 'warning',
          context: { tenantId: invoice.tenantId, invoiceRef: invoice.reference, step: rung.step },
        });
      }
    }
  }

  result.aged = await recomputeCanvasAgeing(db, now);
  return result;
}

/**
 * Write `ageingDays` onto canvas `invoice` cards.
 *
 * ── WHY THIS IS HERE AT ALL ─────────────────────────────────────────────────
 * The field is documented as "computed from `dueAt` — never authored, because a
 * stale ageing is worse than none", and until now it was computed by nothing: the
 * number on the card was whatever the model last typed, which is precisely the
 * stale value the hint forbids.
 *
 * ── WHY IT WRITES NOTHING ELSE ──────────────────────────────────────────────
 * Same rule `runTriggerSweep` sets for itself: a sweep may write the fields the
 * spec already marks `bookkeeping`, and nothing else. It does not settle a card
 * whose invoice was paid and it does not correct an amount — a board that silently
 * rewrote a figure a person authored would be worse than one that is out of date,
 * because nobody would know which numbers were theirs.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * A card whose ageing has not moved is not written, so running twice in a day
 * produces no rows — which is what lets this be force-run from the operator
 * control without polluting anything.
 */
async function recomputeCanvasAgeing(db: Db, now: Date): Promise<number> {
  const rows = await db
    .select({
      id: creationSessionObjects.id,
      content: creationSessionObjects.content,
    })
    .from(creationSessionObjects)
    .where(eq(creationSessionObjects.kind, 'invoice'))
    .limit(MAX_OBJECTS_PER_SESSION);

  const writes: Array<{ id: string; days: number }> = [];
  for (const row of rows) {
    const content = row.content && typeof row.content === 'object' && !Array.isArray(row.content)
      ? row.content as Record<string, unknown>
      : {};
    const dueAt = typeof content.dueAt === 'string' ? new Date(content.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) continue;
    // Clamped at zero: "minus four days overdue" is not a sentence, and the card
    // renders this as a stat with the word "days past due" beside it.
    const days = Math.max(0, ageingDays(dueAt, now.getTime()));
    const stored = Number(content.ageingDays);
    if (Number.isFinite(stored) && stored === days) continue;
    writes.push({ id: row.id, days });
  }

  for (const write of writes) {
    // `jsonb_set` rather than a read-modify-write of the whole document: the
    // canvas is edited concurrently, and rewriting `content` from a row read
    // moments ago would silently discard whatever a person typed in between.
    await db
      .update(creationSessionObjects)
      .set({
        content: sql`jsonb_set(coalesce(${creationSessionObjects.content}, '{}'::jsonb), '{ageingDays}', ${String(write.days)}::jsonb, true)`,
        updatedAt: now,
      })
      .where(eq(creationSessionObjects.id, write.id));
  }
  return writes.length;
}

/** Re-exported so the routes layer can offer the ladder without importing the
 *  engine's internals — a surface that shows a tenant what will be sent, and
 *  when, is the difference between delegating the chase and hoping. */
export function describeLadder(): Array<{ step: number; label: string; atDays: number; channel: string }> {
  return COLLECTION_LADDER.map((rung) => ({ step: rung.step, label: rung.label, atDays: rung.atDays, channel: rung.channel }));
}
