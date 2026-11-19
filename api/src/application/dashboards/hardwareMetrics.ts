/**
 * HARDWARE METRICS (PRD 25 Slice D) — hardware, robotics, defence.
 * Observed from `metric_facts`, declared from `custom_kpis`; null when neither.
 */

import type { MetricDef } from './metricRegistry';
import { observedOrDeclared, stageValue } from './declaredStageKpi';

export const PRODUCTION_STAGES = [
  'prototype', 'pilot_run', 'first_production_run', 'rate_production',
] as const;

export const HARDWARE_METRICS: Record<string, MetricDef> = {
  'hardware.bomCost': {
    label: 'BOM cost',
    unit: 'USD',
    description: 'Unit bill-of-materials cost.',
    goodWhenUp: false,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'hardware.bomCost', days),
  },
  'hardware.grossMargin': {
    label: 'Hardware gross margin',
    unit: '%',
    description: '(ASP − unit COGS) ÷ ASP.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      const asp = await observedOrDeclared(db, tenantId, 'hardware.asp', days);
      const cogs = await observedOrDeclared(db, tenantId, 'hardware.unit_cogs', days);
      if (asp == null || cogs == null || asp === 0) {
        return observedOrDeclared(db, tenantId, 'hardware.grossMargin', days);
      }
      return ((asp - cogs) / asp) * 100;
    },
  },
  'hardware.backlog': {
    label: 'Signed backlog',
    unit: 'USD',
    description: 'Signed backlog value (orders and contracts not yet delivered).',
    goodWhenUp: true,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'hardware.backlog', days),
  },
  'hardware.productionStage': {
    label: 'Production run stage',
    unit: 'stage',
    description: 'prototype → pilot run → first production run → rate production.',
    goodWhenUp: true,
    stages: PRODUCTION_STAGES,
    compute: (db, tenantId) => stageValue(db, tenantId, 'hardware.productionStage', PRODUCTION_STAGES),
  },
};
