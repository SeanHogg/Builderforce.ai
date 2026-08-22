import type { ComponentDef } from './types';
import { AI_HUB_COMPONENTS, DELIVERY_HUB_COMPONENTS } from '@/components/insights/widgets/hubWidgets';
import { ASK_COMPONENTS } from '@/components/insights/widgets/askWidget';
import { AI_IMPACT_COMPONENTS } from '@/components/insights/widgets/aiImpactWidgets';
import { LLM_USAGE_COMPONENTS } from '@/components/insights/widgets/llmUsageWidgets';
import { DELIVERY_COMPONENTS } from '@/components/insights/widgets/deliveryWidgets';
import { AUTONOMY_COMPONENTS } from '@/components/insights/widgets/autonomyWidgets';
import { CHAT_MODE_COMPONENTS } from '@/components/insights/widgets/chatModeWidgets';
import { FINANCE_COMPONENTS } from '@/components/insights/widgets/financeWidgets';
import { FORECAST_COMPONENTS } from '@/components/insights/widgets/forecastWidgets';
import { CORE_COMPONENTS } from '@/components/widgets/registry-modules/coreWidgets';
import { CATALOG_COMPONENTS } from '@/components/widgets/registry-modules/catalogWidgets';
import { OPERATIONAL_COMPONENTS } from '@/components/widgets/registry-modules/operationalWidgets';
import { OBSERVABILITY_COMPONENTS } from '@/components/widgets/registry-modules/observabilityWidgets';
import { INCIDENT_COMPONENTS } from '@/components/widgets/registry-modules/incidentWidgets';
import { WORKFORCE_COMPONENTS } from '@/components/widgets/registry-modules/workforceWidgets';
import { WORKFORCE_PLAN_COMPONENTS } from '@/components/widgets/registry-modules/workforcePlanWidgets';
import { EMP_METRICS_COMPONENTS } from '@/components/widgets/registry-modules/empMetricsWidgets';
import { PAID_MEDIA_COMPONENTS } from '@/components/widgets/registry-modules/paidMediaWidgets';
import { WORKFORCE_HEALTH_COMPONENTS } from '@/components/insights/workforceHealthWidget';
import { APP_SURFACE_COMPONENTS } from '@/components/surfaces/appSurfaces';

/**
 * The single aggregation point for the app-wide COMPONENT registry.
 *
 * Every surface that wants its components mountable adds its module's
 * `*_COMPONENTS` array here. This is the ONLY file that grows as surfaces are
 * decomposed into components — the registry, the dashboard, every picker, the pin
 * layer, the board palette and the embed route all read {@link registry.ts},
 * which derives entirely from this list. Keep groups together for a tidy picker.
 *
 * A module's entries declare their own `mounts`; this file does not decide where
 * anything may render. That is why adding the app-mountable surfaces below is one
 * import and no conditional — the thing that used to be a 13-branch switch in
 * `app/embed/[view]/page.tsx`.
 */
export const ALL_COMPONENTS: ComponentDef[] = [
  // ── Insights HUBS ──
  // The at-a-glance tiles of /insights/ai and /insights/delivery. They are
  // registered first because they are what those pages ARE — the hubs render
  // their own widgets from this registry rather than owning a private layout, so
  // a hub tile and a pinned copy of it are the same component.
  ...AI_HUB_COMPONENTS,
  ...DELIVERY_HUB_COMPONENTS,
  ...ASK_COMPONENTS,
  // ── Insights lenses ──
  ...AI_IMPACT_COMPONENTS,
  ...LLM_USAGE_COMPONENTS,
  ...DELIVERY_COMPONENTS,
  ...AUTONOMY_COMPONENTS,
  ...CHAT_MODE_COMPONENTS,
  ...FINANCE_COMPONENTS,
  ...FORECAST_COMPONENTS,
  // Paid media — the CMO's `measure` half, pinnable anywhere rather than only
  // inside the canvas panel that launches the spend.
  ...PAID_MEDIA_COMPONENTS,
  // ── Non-insights surfaces (proves the registry is app-wide) ──
  ...CORE_COMPONENTS,
  ...CATALOG_COMPONENTS,
  ...OPERATIONAL_COMPONENTS,
  ...OBSERVABILITY_COMPONENTS,
  ...INCIDENT_COMPONENTS,
  ...WORKFORCE_COMPONENTS,
  ...WORKFORCE_PLAN_COMPONENTS,
  ...EMP_METRICS_COMPONENTS,
  ...WORKFORCE_HEALTH_COMPONENTS,
  // ── Full surfaces (mounts: app + canvas) ──
  // Not dashboard tiles: these are the whole kanban, the whole roadmap, the whole
  // governance tracker — what somebody drops onto a board or embeds in the app
  // they publish. Registered last because they are the newest mount, not the
  // least important one.
  ...APP_SURFACE_COMPONENTS,
];
