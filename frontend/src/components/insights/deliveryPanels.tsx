'use client';

/**
 * Single source of truth for the consolidated DELIVERY hub's drill-down panels.
 *
 * Every delivery report that used to be its own route (Delivery, Bottlenecks,
 * DORA, SPACE, Benchmarking, Innovation Funnel) is declared here once as a
 * reusable {@link DeliveryPanelDef} — the full lens (the drill-down `render`),
 * its i18n title/description, and the RBAC capability that gates it. The
 * dashboard tiles drill into the lenses via a slide-out side panel, and the
 * Brain opens the SAME definitions on demand (see DeliveryPanelProvider +
 * DeliveryPanelBrainBridge), so there is exactly one place that knows how to show
 * a delivery insight. Mirrors the AI hub's aiInsightPanels.tsx and the Finance
 * hub's financePanels.tsx.
 *
 * The delivery lenses are self-contained (prop-less) and each owns its own data +
 * time-window controls. A panel that ALSO has a headline worth showing outside
 * the drawer declares a `Summary`; that is the same component the hub renders and
 * the same one the widget registry projects into a pinnable card (hubWidgets.tsx),
 * so a report cannot exist in the drawer and be missing from the picker.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { DeliveryLens } from './DeliveryLens';
import { AutonomyLens } from './AutonomyLens';
import { BottleneckLens } from './BottleneckLens';
import { DoraLens } from './DoraLens';
import { SpaceLens } from './SpaceLens';
import { BenchmarkingLens } from './BenchmarkingLens';
import { FunnelLens } from './FunnelLens';
import { CrossTeamBenchmarkLens } from './CrossTeamBenchmarkLens';
import { DelayTaxonomyLens } from './DelayTaxonomyLens';
import {
  DeliverySummary, BottleneckSummary, DoraSummary, SpaceSummary, BenchmarkingSummary, FunnelSummary,
  AutonomySummary,
} from './DeliverySummaries';

/** Stable ids (also the `?panel=` deep-link + Brain enum values). */
export type DeliveryPanelId =
  | 'delivery' | 'autonomy' | 'bottlenecks' | 'dora' | 'space' | 'benchmarking' | 'funnel'
  | 'crossTeam' | 'delayTaxonomy';

export interface DeliveryPanelDef {
  id: DeliveryPanelId;
  icon: string;
  /** i18n key under the `insights.delivhub` namespace. */
  titleKey: string;
  /** One-line description (i18n key) — used in the Brain tool spec + dashboard. */
  descKey: string;
  /** Capability that gates this panel's content. */
  capability: Capability;
  /** Drawer width (wide for the table/chart-heavy lenses). */
  width?: string;
  /**
   * Compact at-a-glance KPI card for the hub (reads the shared `days`).
   *
   * OPTIONAL, and its absence is meaningful: a panel with no summary is
   * drill-down-only — there is no headline worth a card, so it gets a drawer and
   * no dashboard tile. This is the flag the widget projection reads (see
   * hubWidgets.tsx); it replaced a `() => null` stub, which looked like a summary
   * to every consumer and rendered an empty box.
   */
  Summary?: ComponentType<{ days: number }>;
  /** The full report rendered inside the drill-down slide-out. */
  render: () => ReactNode;
}

const WIDE = 'min(960px, 96vw)';

export const DELIVERY_PANELS: Record<DeliveryPanelId, DeliveryPanelDef> = {
  delivery: {
    id: 'delivery', icon: '📦', titleKey: 'panel.delivery', descKey: 'panel.deliveryDesc',
    capability: 'insights.delivery', width: WIDE, Summary: DeliverySummary, render: () => <DeliveryLens />,
  },
  // Autonomy Health also has its OWN route (/insights/autonomy, the Insights tab).
  // It is registered here as well so the hub card, the widget drill-downs and the
  // Brain can all open the identical lens in the slide-out — one component, one
  // definition, two entry points.
  autonomy: {
    id: 'autonomy', icon: '🕹', titleKey: 'panel.autonomy', descKey: 'panel.autonomyDesc',
    capability: 'insights.autonomy', width: WIDE, Summary: AutonomySummary, render: () => <AutonomyLens />,
  },
  bottlenecks: {
    id: 'bottlenecks', icon: '⏳', titleKey: 'panel.bottlenecks', descKey: 'panel.bottlenecksDesc',
    capability: 'insights.delivery', width: WIDE, Summary: BottleneckSummary, render: () => <BottleneckLens />,
  },
  dora: {
    id: 'dora', icon: '🚀', titleKey: 'panel.dora', descKey: 'panel.doraDesc',
    capability: 'insights.delivery', width: WIDE, Summary: DoraSummary, render: () => <DoraLens />,
  },
  space: {
    id: 'space', icon: '🛰', titleKey: 'panel.space', descKey: 'panel.spaceDesc',
    capability: 'insights.delivery', width: WIDE, Summary: SpaceSummary, render: () => <SpaceLens />,
  },
  benchmarking: {
    id: 'benchmarking', icon: '📊', titleKey: 'panel.benchmarking', descKey: 'panel.benchmarkingDesc',
    capability: 'insights.benchmarking', width: WIDE, Summary: BenchmarkingSummary, render: () => <BenchmarkingLens />,
  },
  funnel: {
    id: 'funnel', icon: '💡', titleKey: 'panel.funnel', descKey: 'panel.funnelDesc',
    capability: 'insights.portfolio', width: WIDE, Summary: FunnelSummary, render: () => <FunnelLens />,
  },
  crossTeam: {
    id: 'crossTeam', icon: '🏁', titleKey: 'panel.crossTeam', descKey: 'panel.crossTeamDesc',
    capability: 'insights.crossTeam', width: WIDE, render: () => <CrossTeamBenchmarkLens />,
  },
  delayTaxonomy: {
    id: 'delayTaxonomy', icon: '🧭', titleKey: 'panel.delayTaxonomy', descKey: 'panel.delayTaxonomyDesc',
    capability: 'insights.delayTaxonomy', width: WIDE, render: () => <DelayTaxonomyLens />,
  },
};

export const DELIVERY_PANEL_IDS = Object.keys(DELIVERY_PANELS) as DeliveryPanelId[];

export function isDeliveryPanelId(v: unknown): v is DeliveryPanelId {
  return typeof v === 'string' && v in DELIVERY_PANELS;
}
