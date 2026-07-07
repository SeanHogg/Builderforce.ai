import type { WidgetDef } from './types';
import { AI_IMPACT_WIDGETS } from '@/components/insights/widgets/aiImpactWidgets';
import { LLM_USAGE_WIDGETS } from '@/components/insights/widgets/llmUsageWidgets';
import { DELIVERY_WIDGETS } from '@/components/insights/widgets/deliveryWidgets';
import { FINANCE_WIDGETS } from '@/components/insights/widgets/financeWidgets';
import { FORECAST_WIDGETS } from '@/components/insights/widgets/forecastWidgets';
import { CORE_WIDGETS } from '@/components/widgets/registry-modules/coreWidgets';
import { CATALOG_WIDGETS } from '@/components/widgets/registry-modules/catalogWidgets';
import { OPERATIONAL_WIDGETS } from '@/components/widgets/registry-modules/operationalWidgets';
import { OBSERVABILITY_WIDGETS } from '@/components/widgets/registry-modules/observabilityWidgets';
import { WORKFORCE_WIDGETS } from '@/components/widgets/registry-modules/workforceWidgets';
import { WORKFORCE_PLAN_WIDGETS } from '@/components/widgets/registry-modules/workforcePlanWidgets';
import { EMP_METRICS_WIDGETS } from '@/components/widgets/registry-modules/empMetricsWidgets';

/**
 * The single aggregation point for the app-wide widget registry.
 *
 * Every surface that wants its visualizations to be pinnable adds its widget
 * module's `*_WIDGETS` array here. This is the ONLY file that grows as new
 * surfaces are converted from text-badge metrics to pinnable chart widgets — the
 * registry, dashboard, picker, and pin layer all read from {@link registry.ts}
 * which derives entirely from this list. Keep groups together for a tidy picker.
 */
export const ALL_WIDGETS: WidgetDef[] = [
  // ── Insights lenses ──
  ...AI_IMPACT_WIDGETS,
  ...LLM_USAGE_WIDGETS,
  ...DELIVERY_WIDGETS,
  ...FINANCE_WIDGETS,
  ...FORECAST_WIDGETS,
  // ── Non-insights surfaces (proves the registry is app-wide) ──
  ...CORE_WIDGETS,
  ...CATALOG_WIDGETS,
  ...OPERATIONAL_WIDGETS,
  ...OBSERVABILITY_WIDGETS,
  ...WORKFORCE_WIDGETS,
  ...WORKFORCE_PLAN_WIDGETS,
  ...EMP_METRICS_WIDGETS,
];
