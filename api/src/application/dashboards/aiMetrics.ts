/**
 * AI-native unit economics (PRD 25 §6.2 / §25a.3 B2).
 *
 * Inference margin and efficiency are declared until a producer writes observed
 * inference spend against revenue. A missing value is `null`, never `0`.
 */

import type { MetricDef } from './metricRegistry';
import { latestDeclaredValue } from './declaredKpi';

function declaredMetric(
  key: string,
  label: string,
  unit: string,
  description: string,
  goodWhenUp: boolean,
): MetricDef {
  return {
    label,
    unit,
    description,
    goodWhenUp,
    async compute(db, tenantId) {
      return latestDeclaredValue(db, tenantId, key);
    },
  };
}

export const AI_METRICS: Record<string, MetricDef> = {
  'ai.inferenceMarginPct': declaredMetric(
    'ai.inferenceMarginPct',
    'Inference margin',
    '%',
    'Gross margin after inference cost of revenue.',
    true,
  ),
  'ai.inferenceCostPerUnit': declaredMetric(
    'ai.inferenceCostPerUnit',
    'Inference cost per unit',
    'USD',
    'Inference spend per delivered unit. Lower is better.',
    false,
  ),
  'ai.inferenceEfficiency': declaredMetric(
    'ai.inferenceEfficiency',
    'Inference efficiency',
    '',
    'Revenue per unit of inference spend. Higher is better.',
    true,
  ),
};
