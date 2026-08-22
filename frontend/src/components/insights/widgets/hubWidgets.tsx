'use client';

/**
 * The insights HUBS, decomposed into individually-pinnable widgets.
 *
 * `/insights/ai` and `/insights/delivery` used to be hand-laid-out canvas boards:
 * a fixed set of floating panels that existed only on that one page. Everything
 * they show is now a registered {@link ComponentDef} instead, which is what lets the
 * same tile appear on the hub, on a user's home dashboard, on a shared dashboard
 * and on a canvas — one definition, every surface.
 *
 * ── Why this file is a PROJECTION, not a second registry ──────────────────────
 * The hub tiles ARE the panel registries' summaries: `AI_INSIGHT_PANELS` and
 * `DELIVERY_PANELS` already declare, per report, its i18n keys, the capability
 * that gates it, its compact `Summary` and the full lens behind it. Re-typing
 * that here as a hand-written widget list is how a new delivery report ends up in
 * the drill-down drawer and silently NOT in the picker. So the panel registries
 * are mapped into widgets: add a panel with a summary, get a widget.
 *
 * A panel with no `Summary` is drill-down-only (crossTeam, delayTaxonomy) and
 * projects to no widget — an always-blank tile in the picker is worse than an
 * absent one.
 *
 * The two hero cards — the AI token headline and the delivery verdict — are not
 * panels, so they are declared here directly. Both render frameless bodies; the
 * WidgetCard chrome owns the frame, title and pin.
 */

import type { ComponentType } from 'react';
import type { ComponentSurfaceProps, ComponentDef } from '@/lib/components/types';
import { AiConsumptionHeader } from '../AiConsumptionHeader';
import { DeliveryVerdict } from '../DeliveryVerdict';
import { AI_INSIGHT_PANELS, AI_INSIGHT_PANEL_IDS, type AiInsightPanelId } from '../aiInsightPanels';
import { DELIVERY_PANELS, DELIVERY_PANEL_IDS, type DeliveryPanelId } from '../deliveryPanels';

/**
 * i18n key (under `widgets.title`) per hub tile. Spelled out rather than derived
 * from the id so the catalogs stay greppable and a renamed panel id is a compile
 * error here instead of a silently missing translation at runtime.
 */
const AI_TITLE_KEY: Record<AiInsightPanelId, string> = {
  'ai-impact': 'aiHubImpact',
  engineering: 'aiHubEngineering',
  'llm-usage': 'aiHubLlmUsage',
  recommendations: 'aiHubRecommendations',
};

/** The one-line explainer each tile carried on the canvas hub, kept on the card. */
const descOf = (titleKey: string) => `${titleKey}Desc`;

const DELIVERY_TITLE_KEY: Record<DeliveryPanelId, string> = {
  delivery: 'delivHubDelivery',
  autonomy: 'delivHubAutonomy',
  bottlenecks: 'delivHubBottlenecks',
  dora: 'delivHubDora',
  space: 'delivHubSpace',
  benchmarking: 'delivHubBenchmarking',
  funnel: 'delivHubFunnel',
  crossTeam: 'delivHubCrossTeam',
  delayTaxonomy: 'delivHubDelayTaxonomy',
};

/**
 * Layout hint per hub tile. A KPI grid needs room to BE a grid — at the default
 * `sm` (one 240px column) the four DORA keys stack into a ribbon — so every
 * summary is at least `md`, and the ones carrying a chart, a list or five
 * dimensions take a full row.
 */
const AI_SIZE: Record<AiInsightPanelId, ComponentDef['size']> = {
  'ai-impact': 'lg',
  engineering: 'md',
  'llm-usage': 'md',
  recommendations: 'md',
};

const DELIVERY_SIZE: Partial<Record<DeliveryPanelId, ComponentDef['size']>> = {
  dora: 'lg',
  space: 'lg',
};

/**
 * A panel's summary, as a widget body. The summary already self-fetches through
 * the deduped source layer and renders its own empty/error state, so the widget
 * IS the summary — no wrapper logic, and therefore no way for the hub tile and
 * the drill-down to disagree about a number.
 */
function bodyOf(Summary: ComponentType<{ days: number }>): ComponentType<ComponentSurfaceProps> {
  return function HubSummaryBody({ days }: ComponentSurfaceProps) {
    return <Summary days={days} />;
  };
}

// ── AI hub ────────────────────────────────────────────────────────────────────

const AI_PANEL_COMPONENTS: ComponentDef[] = AI_INSIGHT_PANEL_IDS.map((id) => {
  const def = AI_INSIGHT_PANELS[id];
  return {
    id: `ai-hub.${id}`,
    group: 'aiHub',
    titleKey: AI_TITLE_KEY[id],
    descKey: descOf(AI_TITLE_KEY[id]),
    capability: def.capability,
    size: AI_SIZE[id],
    Surface: bodyOf(def.Summary),
    drill: { kind: 'panel', hub: 'ai', panel: id },
  } satisfies ComponentDef;
});

export const AI_HUB_COMPONENTS: ComponentDef[] = [
  {
    id: 'ai-hub.consumption',
    group: 'aiHub',
    titleKey: 'aiHubConsumption',
    descKey: 'aiHubConsumptionDesc',
    size: 'lg',
    // No capability: the consumption snapshot is the all-members meter the
    // sidebar already shows, so gating it here would hide from a member a figure
    // they can read two panels away. It self-gates on having a meter at all.
    Surface: AiConsumptionHeader,
  },
  ...AI_PANEL_COMPONENTS,
];

/** Ids in the order the AI hub lays them out (hero first, then the reports). */
export const AI_HUB_WIDGET_IDS = AI_HUB_COMPONENTS.map((w) => w.id);

// ── Delivery hub ──────────────────────────────────────────────────────────────

const DELIVERY_PANEL_COMPONENTS: ComponentDef[] = DELIVERY_PANEL_IDS.flatMap((id) => {
  const def = DELIVERY_PANELS[id];
  const Summary = def.Summary;
  if (!Summary) return []; // drill-down-only panel — nothing to put in a card
  return [{
    id: `delivery-hub.${id}`,
    group: 'deliveryHub',
    titleKey: DELIVERY_TITLE_KEY[id],
    descKey: descOf(DELIVERY_TITLE_KEY[id]),
    capability: def.capability,
    size: DELIVERY_SIZE[id] ?? 'md',
    Surface: bodyOf(Summary),
    drill: { kind: 'panel', hub: 'delivery', panel: id },
  } satisfies ComponentDef];
});

export const DELIVERY_HUB_COMPONENTS: ComponentDef[] = [
  {
    id: 'delivery.verdict',
    group: 'deliveryHub',
    titleKey: 'delivHubVerdict',
    descKey: 'delivHubVerdictDesc',
    capability: 'insights.delivery',
    size: 'lg',
    Surface: DeliveryVerdict,
  },
  ...DELIVERY_PANEL_COMPONENTS,
];

/** Ids in the order the Delivery hub lays them out (verdict first, then reports). */
export const DELIVERY_HUB_WIDGET_IDS = DELIVERY_HUB_COMPONENTS.map((w) => w.id);
