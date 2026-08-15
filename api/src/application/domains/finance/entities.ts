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
  customKpis,
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
