import type { WidgetDef } from './types';
import { AI_HUB_WIDGETS, DELIVERY_HUB_WIDGETS } from '@/components/insights/widgets/hubWidgets';
import { ASK_WIDGETS } from '@/components/insights/widgets/askWidget';
import { AI_IMPACT_WIDGETS } from '@/components/insights/widgets/aiImpactWidgets';
import { LLM_USAGE_WIDGETS } from '@/components/insights/widgets/llmUsageWidgets';
import { DELIVERY_WIDGETS } from '@/components/insights/widgets/deliveryWidgets';
import { AUTONOMY_WIDGETS } from '@/components/insights/widgets/autonomyWidgets';
import { CHAT_MODE_WIDGETS } from '@/components/insights/widgets/chatModeWidgets';
import { FINANCE_WIDGETS } from '@/components/insights/widgets/financeWidgets';
import { FORECAST_WIDGETS } from '@/components/insights/widgets/forecastWidgets';
import { CORE_WIDGETS } from '@/components/widgets/registry-modules/coreWidgets';
import { CATALOG_WIDGETS } from '@/components/widgets/registry-modules/catalogWidgets';
import { OPERATIONAL_WIDGETS } from '@/components/widgets/registry-modules/operationalWidgets';
import { OBSERVABILITY_WIDGETS } from '@/components/widgets/registry-modules/observabilityWidgets';
import { INCIDENT_WIDGETS } from '@/components/widgets/registry-modules/incidentWidgets';
import { WORKFORCE_WIDGETS } from '@/components/widgets/registry-modules/workforceWidgets';
import { WORKFORCE_PLAN_WIDGETS } from '@/components/widgets/registry-modules/workforcePlanWidgets';
import { EMP_METRICS_WIDGETS } from '@/components/widgets/registry-modules/empMetricsWidgets';
import { PAID_MEDIA_WIDGETS } from '@/components/widgets/registry-modules/paidMediaWidgets';
import { WORKFORCE_HEALTH_WIDGETS } from '@/components/insights/workforceHealthWidget';

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
  // ── Insights HUBS ──
  // The at-a-glance tiles of /insights/ai and /insights/delivery. They are
  // registered first because they are what those pages ARE — the hubs render
  // their own widgets from this registry rather than owning a private layout, so
  // a hub tile and a pinned copy of it are the same component.
  ...AI_HUB_WIDGETS,
  ...DELIVERY_HUB_WIDGETS,
  ...ASK_WIDGETS,
  // ── Insights lenses ──
  ...AI_IMPACT_WIDGETS,
  ...LLM_USAGE_WIDGETS,
  ...DELIVERY_WIDGETS,
  ...AUTONOMY_WIDGETS,
  ...CHAT_MODE_WIDGETS,
  ...FINANCE_WIDGETS,
  ...FORECAST_WIDGETS,
  // Paid media — the CMO's `measure` half, pinnable anywhere rather than only
  // inside the canvas panel that launches the spend.
  ...PAID_MEDIA_WIDGETS,
  // ── Non-insights surfaces (proves the registry is app-wide) ──
  ...CORE_WIDGETS,
  ...CATALOG_WIDGETS,
  ...OPERATIONAL_WIDGETS,
  ...OBSERVABILITY_WIDGETS,
  ...INCIDENT_WIDGETS,
  ...WORKFORCE_WIDGETS,
  ...WORKFORCE_PLAN_WIDGETS,
  ...EMP_METRICS_WIDGETS,
  ...WORKFORCE_HEALTH_WIDGETS,
];
