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
  breakEvenScenarios,
  businessPricingModels,
  churnPredictions,
  compensationStructures,
  customKpis,
  expenses,
  fundingRounds,
  invoiceLineItems,
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
