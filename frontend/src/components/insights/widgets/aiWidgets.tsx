/**
 * AI-NATIVE WIDGETS (PRD 25 Slice B5) — inference margin and inference efficiency.
 *
 * Both are scalar tiles over the shared {@link ScalarMetricTile}: value, benchmark
 * band when the cohort has one, delta, and a next-action line. Unmeasured renders
 * "Not measured", never 0.
 */

import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { ScalarMetricTile, type ScalarTileSpec } from './scalarMetricTile';

const AI_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
const AI_CAP = 'insights.finance' as const;

function scalarCard(spec: ScalarTileSpec) {
  return function AiScalarCard({ days }: ComponentSurfaceProps) {
    return <ScalarMetricTile spec={spec} days={days} />;
  };
}

const InferenceMarginCard = scalarCard({ metricKey: 'ai.inferenceMarginPct', format: 'percent', higherIsBetter: true, actionKey: 'inferenceMargin' });
const InferenceEfficiencyCard = scalarCard({ metricKey: 'ai.inferenceEfficiency', format: 'number', higherIsBetter: true, actionKey: 'inferenceEfficiency' });

export const AI_COMPONENTS: ComponentDef[] = [
  { id: 'ai.inference-margin', group: 'founder', titleKey: 'aiInferenceMargin', capability: AI_CAP, size: 'sm', Surface: InferenceMarginCard, drill: AI_DRILL },
  { id: 'ai.inference-efficiency', group: 'founder', titleKey: 'aiInferenceEfficiency', capability: AI_CAP, size: 'sm', Surface: InferenceEfficiencyCard, drill: AI_DRILL },
];
