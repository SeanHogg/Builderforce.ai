/**
 * SECURITY METRICS (PRD 25 Slice D) — cybersecurity.
 * Observed from `metric_facts`, declared from `custom_kpis`; null when neither.
 */

import type { MetricDef } from './metricRegistry';
import { observedOrDeclared, observedSum, ratioOrNull } from './declaredStageKpi';

export const SECURITY_METRICS: Record<string, MetricDef> = {
  'security.pipelineCoverage': {
    label: 'Pipeline coverage',
    unit: 'x',
    description: 'Open pipeline divided by quota (3–5× for enterprise cycles).',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const pipeline = await observedOrDeclared(db, tenantId, 'security.open_pipeline', days);
      const quota = await observedOrDeclared(db, tenantId, 'security.quota', days);
      return ratioOrNull(pipeline, quota)
        ?? observedOrDeclared(db, tenantId, 'security.pipelineCoverage', days);
    },
  },
  'security.pocConversion': {
    label: 'POC conversion',
    unit: '%',
    description: 'Proofs of concept won divided by proofs of concept started.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const won = await observedSum(db, tenantId, 'security.pocs_won', days);
      const started = await observedSum(db, tenantId, 'security.pocs_started', days);
      const r = ratioOrNull(won, started);
      return r == null ? observedOrDeclared(db, tenantId, 'security.pocConversion', days) : r * 100;
    },
  },
  'security.timeToValue': {
    label: 'Time to value',
    unit: 'days',
    description: 'Days from contract to first detection.',
    goodWhenUp: false,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'security.timeToValue', days),
  },
};
