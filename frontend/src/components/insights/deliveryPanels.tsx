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
 * The delivery lenses are self-contained (prop-less) and each owns its own
 * data + time-window controls, so these panels are launcher tiles (no compact
 * dashboard Summary) — the detail lives entirely in the drill-down.
 */

import type { ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { DeliveryLens } from './DeliveryLens';
import { BottleneckLens } from './BottleneckLens';
import { DoraLens } from './DoraLens';
import { SpaceLens } from './SpaceLens';
import { BenchmarkingLens } from './BenchmarkingLens';
import { FunnelLens } from './FunnelLens';

/** Stable ids (also the `?panel=` deep-link + Brain enum values). */
export type DeliveryPanelId =
  | 'delivery' | 'bottlenecks' | 'dora' | 'space' | 'benchmarking' | 'funnel';

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
  /** The full report rendered inside the drill-down slide-out. */
  render: () => ReactNode;
}

const WIDE = 'min(960px, 96vw)';

export const DELIVERY_PANELS: Record<DeliveryPanelId, DeliveryPanelDef> = {
  delivery: {
    id: 'delivery', icon: '📦', titleKey: 'panel.delivery', descKey: 'panel.deliveryDesc',
    capability: 'insights.delivery', width: WIDE, render: () => <DeliveryLens />,
  },
  bottlenecks: {
    id: 'bottlenecks', icon: '⏳', titleKey: 'panel.bottlenecks', descKey: 'panel.bottlenecksDesc',
    capability: 'insights.delivery', width: WIDE, render: () => <BottleneckLens />,
  },
  dora: {
    id: 'dora', icon: '🚀', titleKey: 'panel.dora', descKey: 'panel.doraDesc',
    capability: 'insights.delivery', width: WIDE, render: () => <DoraLens />,
  },
  space: {
    id: 'space', icon: '🛰', titleKey: 'panel.space', descKey: 'panel.spaceDesc',
    capability: 'insights.delivery', width: WIDE, render: () => <SpaceLens />,
  },
  benchmarking: {
    id: 'benchmarking', icon: '📊', titleKey: 'panel.benchmarking', descKey: 'panel.benchmarkingDesc',
    capability: 'insights.benchmarking', width: WIDE, render: () => <BenchmarkingLens />,
  },
  funnel: {
    id: 'funnel', icon: '💡', titleKey: 'panel.funnel', descKey: 'panel.funnelDesc',
    capability: 'insights.portfolio', width: WIDE, render: () => <FunnelLens />,
  },
};

export const DELIVERY_PANEL_IDS = Object.keys(DELIVERY_PANELS) as DeliveryPanelId[];

export function isDeliveryPanelId(v: unknown): v is DeliveryPanelId {
  return typeof v === 'string' && v in DELIVERY_PANELS;
}
