/**
 * CLIMATE METRICS (PRD 25 Slice D) — climate & energy.
 * Observed from `metric_facts`, declared from `custom_kpis`; null when neither.
 */

import type { MetricDef } from './metricRegistry';
import { observedOrDeclared, observedSum, ratioOrNull } from './declaredStageKpi';

export const CLIMATE_METRICS: Record<string, MetricDef> = {
  'climate.unitCostVsIncumbent': {
    label: 'Unit cost vs incumbent',
    unit: '%',
    description: 'Our unit cost (LCOE / cost per tonne / per unit) as a percentage of the incumbent baseline; under 100 is cheaper.',
    goodWhenUp: false,
    async compute(db, tenantId, days) {
      const ours = await observedOrDeclared(db, tenantId, 'climate.unit_cost', days);
      const incumbent = await observedOrDeclared(db, tenantId, 'climate.incumbent_unit_cost', days);
      const r = ratioOrNull(ours, incumbent);
      return r == null ? observedOrDeclared(db, tenantId, 'climate.unitCostVsIncumbent', days) : r * 100;
    },
  },
  'climate.tco2eAbated': {
    label: 'tCO2e abated',
    unit: 'tCO2e',
    description: 'Measured, life-cycle-assessed tonnes of CO2e abated in the window.',
    goodWhenUp: true,
    async compute(db, tenantId, days) {
      return (await observedSum(db, tenantId, 'climate.tco2e_abated', days))
        ?? observedOrDeclared(db, tenantId, 'climate.tco2eAbated', days);
    },
  },
  'climate.capacityDeployed': {
    label: 'Capacity deployed',
    unit: 'MW',
    description: 'Capacity (MW, tonnes or units) in the field.',
    goodWhenUp: true,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'climate.capacityDeployed', days),
  },
  'climate.offtakePipeline': {
    label: 'Offtake pipeline',
    unit: 'USD',
    description: 'Signed offtake / PPA plus LOI and pipeline value.',
    goodWhenUp: true,
    compute: (db, tenantId, days) => observedOrDeclared(db, tenantId, 'climate.offtakePipeline', days),
  },
};
