/**
 * CLINICAL METRICS (PRD 25 Slice D) — medtech / biotech / healthtech.
 *
 * Observed values come from `metric_facts`; hand-entered ones from `custom_kpis`.
 * Milestone tiles (regulatory / development stage, reimbursement status) are
 * `custom_kpis` with `unit: 'stage'` whose value is the ordinal into `stages`.
 * Nothing measured or declared → `null`, never `0`.
 */

import type { MetricDef } from './metricRegistry';
import {
  observedOrDeclared, observedSum, ratioOrNull, stageValue,
} from './declaredStageKpi';

/** Regulatory path (medtech) then development path (biotech) — one ordered list per stage metric. */
export const CLINICAL_STAGES = [
  'concept', 'design_freeze', 'verification', 'submission', 'clearance', 'first_commercial_use',
] as const;
export const DEVELOPMENT_STAGES = [
  'discovery', 'lead', 'ind_enabling', 'ind_cleared', 'phase1', 'phase2', 'phase3', 'bla_nda',
] as const;
export const REIMBURSEMENT_STAGES = [
  'none', 'code_identified', 'coverage_decision', 'payer_contracts',
] as const;

export const CLINICAL_METRICS: Record<string, MetricDef> = {
  'clinical.stage': {
    label: 'Regulatory / development stage',
    unit: 'stage',
    description: 'Current regulatory (medtech) or development (biotech) stage, as an ordinal into the stage list.',
    goodWhenUp: true,
    stages: CLINICAL_STAGES,
    compute: (db, tenantId) => stageValue(db, tenantId, 'clinical.stage', CLINICAL_STAGES),
  },
  'clinical.monthsToMilestone': {
    label: 'Months to next milestone',
    unit: 'months',
    description: 'Planned months to the next regulatory or clinical milestone (compare against runway).',
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'clinical.monthsToMilestone', days),
  },
  'clinical.regulatorySpendPct': {
    label: 'Regulatory spend share',
    unit: '%',
    description: 'Regulatory + clinical spend as a percentage of total spend.',
    async compute(db, tenantId, days) {
      const reg = await observedSum(db, tenantId, 'clinical.regulatory_spend', days);
      const total = await observedSum(db, tenantId, 'clinical.total_spend', days);
      const r = ratioOrNull(reg, total);
      return r == null ? observedOrDeclared(db, tenantId, 'clinical.regulatorySpendPct', days) : r * 100;
    },
  },
  'clinical.costPerDataPoint': {
    label: 'Cost per clinical data point',
    unit: 'USD',
    description: 'Clinical spend divided by enrolled subjects.',
    goodWhenUp: false,
    async compute(db, tenantId, days) {
      const spend = await observedSum(db, tenantId, 'clinical.clinical_spend', days);
      const enrolled = await observedSum(db, tenantId, 'clinical.enrolled_subjects', days);
      return ratioOrNull(spend, enrolled)
        ?? observedOrDeclared(db, tenantId, 'clinical.costPerDataPoint', days);
    },
  },
  'clinical.enrollmentRate': {
    label: 'Enrollment vs plan',
    unit: '%',
    description: 'Subjects enrolled as a percentage of the enrollment plan.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const enrolled = await observedSum(db, tenantId, 'clinical.enrolled_subjects', days);
      const plan = await observedSum(db, tenantId, 'clinical.enrollment_plan', days);
      const r = ratioOrNull(enrolled, plan);
      return r == null ? observedOrDeclared(db, tenantId, 'clinical.enrollmentRate', days) : r * 100;
    },
  },
  'clinical.reimbursementStatus': {
    label: 'Reimbursement status',
    unit: 'stage',
    description: 'none → code identified → coverage decision → payer contracts.',
    goodWhenUp: true,
    stages: REIMBURSEMENT_STAGES,
    compute: (db, tenantId) => stageValue(db, tenantId, 'clinical.reimbursementStatus', REIMBURSEMENT_STAGES),
  },
};
