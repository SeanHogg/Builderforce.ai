/**
 * VERTICAL WIDGETS (PRD 25 Slice D) — the §5.3 KPI cards for the eight verticals
 * beyond SaaS/AI, grouped by metric family and declared as DATA.
 *
 * Every card is a list of whitelisted metric keys (or a StageBar over a stage
 * list) read through the shared typed client; "Not measured" is the rendered
 * state of a null, never 0. Milestone cards share one `StageBar`.
 */

import type { ComponentDef } from '@/lib/components/types';
import { metricListDef, stageDef } from './verticalTiles';

/** Stage lists as data — mirrors the api metric defs (`clinicalMetrics.ts`, `hardwareMetrics.ts`). */
const CLINICAL_STAGES = ['concept', 'design_freeze', 'verification', 'submission', 'clearance', 'first_commercial_use'] as const;
const REIMBURSEMENT_STAGES = ['none', 'code_identified', 'coverage_decision', 'payer_contracts'] as const;
const PRODUCTION_STAGES = ['prototype', 'pilot_run', 'first_production_run', 'rate_production'] as const;

export const FINTECH_COMPONENTS: ComponentDef[] = [
  metricListDef('payments.volume', 'verticals', 'paymentsVolume', ['payments.tpv', 'payments.takeRate', 'payments.fundedAccountRatio']),
  metricListDef('payments.risk', 'verticals', 'paymentsRisk', ['payments.fraudLossBps', 'payments.payoutLatency']),
];

export const CLINICAL_COMPONENTS: ComponentDef[] = [
  stageDef('clinical.stage', 'verticals', 'clinicalStage', 'clinical.stage', CLINICAL_STAGES, ['clinical.monthsToMilestone', 'clinical.regulatorySpendPct']),
  stageDef('clinical.reimbursement', 'verticals', 'clinicalReimbursement', 'clinical.reimbursementStatus', REIMBURSEMENT_STAGES),
  metricListDef('clinical.trial-economics', 'verticals', 'clinicalTrialEconomics', ['clinical.costPerDataPoint', 'clinical.enrollmentRate']),
];

export const CLIMATE_COMPONENTS: ComponentDef[] = [
  metricListDef('climate.cost-curve', 'verticals', 'climateCostCurve', ['climate.unitCostVsIncumbent', 'climate.tco2eAbated']),
  metricListDef('climate.deployment', 'verticals', 'climateDeployment', ['climate.capacityDeployed', 'climate.offtakePipeline']),
];

export const HARDWARE_COMPONENTS: ComponentDef[] = [
  stageDef('hardware.production-stage', 'verticals', 'hardwareProductionStage', 'hardware.productionStage', PRODUCTION_STAGES, ['hardware.bomCost']),
  metricListDef('hardware.margin-backlog', 'verticals', 'hardwareMarginBacklog', ['hardware.grossMargin', 'hardware.backlog']),
];

export const SECURITY_COMPONENTS: ComponentDef[] = [
  metricListDef('security.pipeline', 'verticals', 'securityPipeline', ['security.pipelineCoverage', 'security.pocConversion', 'security.timeToValue']),
];

export const MARKETPLACE_COMPONENTS: ComponentDef[] = [
  metricListDef('market.liquidity', 'verticals', 'marketLiquidity', ['market.liquidity', 'market.repeatRate']),
  metricListDef('market.unit-economics', 'verticals', 'marketUnitEconomics', ['market.gmv', 'market.contributionPerOrder']),
];

export const VERTICAL_COMPONENTS: ComponentDef[] = [
  ...FINTECH_COMPONENTS,
  ...CLINICAL_COMPONENTS,
  ...CLIMATE_COMPONENTS,
  ...HARDWARE_COMPONENTS,
  ...SECURITY_COMPONENTS,
  ...MARKETPLACE_COMPONENTS,
];
