/**
 * Finance entities — owned by the **CFO** (PRD 20 §3.2, migration 0424).
 *
 * The domain's root is the kernel's `ledger_entry`, which is why no balance
 * table appears here: points, credits, campaign dollars and payouts are
 * denominations of one ledger (§2). What is left is the planning half —
 * scenarios, assumptions, pricing models and the KPIs computed from them.
 */
import {
  billingPlans,
  bills,
  breakEvenScenarios,
  businessPricingModels,
  churnPredictions,
  compensationStructures,
  convertibleInstruments,
  customKpis,
  equityEvents,
  equityGrants,
  expenses,
  fundingRounds,
  invoiceLineItems,
  invoices,
  kpiFormulas,
  monteCarloSimulations,
  paybackPeriod,
  paymentMethods,
  planFeatures,
  pointRedemptions,
  pricingSimulations,
  roiTimelineEntries,
  savedCalculations,
  scenarioAssumptions,
  collectionActions,
  payRuns,
  shareClasses,
  timesheets,
} from '../../../infrastructure/database/schema/finance';
import { defineDomainEntities, entity } from '../entityDefinition';

export const FINANCE_ENTITIES = defineDomainEntities('finance', [
  entity(breakEvenScenarios, { kind: 'scenario', registers: true }),
  entity(expenses, { kind: 'expense', registers: true }),
  entity(billingPlans, { kind: 'plan', registers: true }),
  planFeatures,
  businessPricingModels,
  pricingSimulations,
  scenarioAssumptions,
  monteCarloSimulations,
  savedCalculations,
  customKpis,
  kpiFormulas,
  /**
   * The receivable header (0469) — what `invoice_line_items.invoice_ref` was
   * always pointing at. Writable through the generic path: authoring a draft
   * invoice is ordinary work, and the acts that are NOT ordinary (issuing it,
   * recording a payment) are gated separately by `canvasApprovalGate`.
   */
  entity(invoices, { kind: 'invoice', registers: true }),
  /**
   * The payable header. READ-ONLY through the generic path, and this one is not
   * symmetry with `invoices` — it is `approved_by`. The object's own hint calls
   * it "the one field on this object that can cause real harm", and a generic
   * PATCH is exactly the surface that would fill it in on the requester's behalf.
   * Every write goes through the three handlers, which refuse self-approval.
   */
  entity(bills, { kind: 'bill', registers: true, readOnly: true }),
  invoiceLineItems,
  /** A stored payment instrument. The processor owns it; the row is a pointer,
   *  and its secret columns are redacted. */
  entity(paymentMethods, { readOnly: true }),
  fundingRounds,
  /**
   * Ownership (0927). A share class is a board resolution — authorising one is
   * ordinary work, so it stays writable through the generic path and `registers`
   * because a person navigates to it.
   */
  entity(shareClasses, { kind: 'shareClass', registers: true }),
  /**
   * A payroll run (0926). It already carries an `object_id` — it was registering
   * into the kernel's `objects` table while having no entity definition, which is
   * the halfway state the catalog exists to prevent: navigable by id, invisible to
   * the generic layer. READ-ONLY because the bureau or connector owns the figures;
   * the one thing a person legitimately does to a run here is look at it, and a
   * generic PATCH over a pay run edits what somebody was paid.
   */
  entity(payRuns, { kind: 'payRun', registers: true, readOnly: true }),
  /**
   * A dunning-ladder action is an APPEND-ONLY log entry keyed by (invoice, rung),
   * not an object: it has no title, no lifecycle of its own, and nothing a person
   * opens. It is deliberately NOT registered — the invoice is the object, and this
   * is a fact about what was sent chasing it.
   */
  collectionActions,
  /**
   * A grant, a convertible and an event are READ-ONLY here, and the reason is not
   * symmetry with `bills` — it is that a generic PATCH over any of the three
   * rewrites who owns the company.
   *
   *  · `equity_grants` carries no quantity by design; the count is the issuance
   *    EVENT, and a create through this path would produce a grant with no event
   *    behind it — a certificate the cap table cannot see.
   *  · `convertible_instruments.status` decides whether a SAFE still dilutes the
   *    next round. Flipping it to 'converted' with no conversion event behind it
   *    removes money from the stack that is still owed shares.
   *  · `equity_events` is APPEND-ONLY. Read-only here is what makes that true
   *    rather than documented: the one writer only ever INSERTs.
   */
  entity(equityGrants, { kind: 'equityGrant', registers: true, readOnly: true }),
  entity(convertibleInstruments, { kind: 'convertible', registers: true, readOnly: true }),
  entity(equityEvents, { kind: 'equityEvent', readOnly: true }),
  compensationStructures,
  timesheets,
  paybackPeriod,
  roiTimelineEntries,
  /** A model's forecast, not a fact somebody adjusts. */
  entity(churnPredictions, { readOnly: true }),
  /** Spending points debits the ledger. A redemption row edited in place is the
   *  same money invented twice. */
  entity(pointRedemptions, { readOnly: true }),
]);
