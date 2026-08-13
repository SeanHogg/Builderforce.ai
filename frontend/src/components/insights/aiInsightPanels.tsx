'use client';

/**
 * Single source of truth for the consolidated AI Insights hub's drill-down
 * panels.
 *
 * Every AI report that used to be its own route (AI Impact, AI Effectiveness,
 * Recommendations) is declared here once as a reusable {@link AiInsightPanelDef}
 * — a full lens (the drill-down `render`), a compact dashboard `Summary`, its
 * i18n title/description, and the RBAC capability that gates it. The dashboard
 * renders the summaries and drills into the lenses via a slide-out side panel,
 * and the Brain opens the SAME definitions on demand (see AiInsightPanelProvider
 * + AiInsightPanelBrainBridge), so there is exactly one place that knows how to
 * show an AI insight. Mirrors the Finance hub's financePanels.tsx.
 */

import dynamic from 'next/dynamic';
import type { ComponentType, ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { AiImpactSummary, EngineeringSummary, RecommendationsSummary, LlmUsageSummary } from './AiInsightSummaries';

/**
 * The lenses load ON DEMAND, and that is load-bearing in two ways.
 *
 * 1. It breaks a CYCLE. `AiImpactLens` renders `<WidgetGrid>`, which reads
 *    `lib/widgets/registry`, which reads `allWidgets`, which reads
 *    `hubWidgets` — and `hubWidgets` projects THIS registry into pinnable cards,
 *    so it imports `AI_INSIGHT_PANEL_IDS` back from here. Statically that closes
 *    a loop, and a loop is only ever as safe as its entry point: this module is
 *    reached first (the root layout mounts `AiInsightPanelProvider` on every
 *    page), so `hubWidgets` ran while `AI_INSIGHT_PANEL_IDS` was still in its
 *    temporal dead zone and every route — including the marketing homepage —
 *    died on `Cannot access 'AI_INSIGHT_PANEL_IDS' before initialization`.
 *    A `dynamic()` edge is asynchronous, so it is not part of module-evaluation
 *    order and cannot form an initialization loop at all.
 * 2. A lens is DRAWER-ONLY — it renders when someone opens a drill-down. Eagerly
 *    importing all four put four full reports in the shared chunk that the root
 *    layout loads for every visitor, including one who only ever reads `/`.
 *
 * The summaries stay static: they are compact KPI cards the hub and the widget
 * registry render immediately, and they do not reach the widget registry.
 * `check-frontend-architecture.mjs` fails the build if a static import ever
 * re-closes this loop.
 */
const AiImpactLens = dynamic(() => import('./AiImpactLens').then((module) => module.AiImpactLens), { ssr: false });
const EngineeringLens = dynamic(() => import('./EngineeringLens').then((module) => module.EngineeringLens), { ssr: false });
const RecommendationsLens = dynamic(() => import('./RecommendationsLens').then((module) => module.RecommendationsLens), { ssr: false });
const LlmUsageLens = dynamic(() => import('./LlmUsageLens').then((module) => module.LlmUsageLens), { ssr: false });

/** Stable ids (also the `?panel=` deep-link + Brain enum values). */
export type AiInsightPanelId = 'ai-impact' | 'engineering' | 'llm-usage' | 'recommendations';

export interface AiInsightPanelDef {
  id: AiInsightPanelId;
  icon: string;
  /** i18n key under the `insights.aihub` namespace. */
  titleKey: string;
  /** One-line description (i18n key) — used in the Brain tool spec + dashboard. */
  descKey: string;
  /** Capability that gates this panel's content. */
  capability: Capability;
  /** Drawer width (wide for the table-heavy lenses). */
  width?: string;
  /** Compact KPI card for the dashboard (reads `days` from the shared window).
   *  Three of these (AI Impact / Engineering / Recommendations) come out of ONE
   *  bundled `/ai-overview` read — shared through the deduped source layer, not
   *  handed down as props, so the single round-trip holds wherever they mount. */
  Summary: ComponentType<{ days: number }>;
  /** The full report rendered inside the drill-down slide-out. */
  render: () => ReactNode;
}

const WIDE = 'min(880px, 96vw)';

export const AI_INSIGHT_PANELS: Record<AiInsightPanelId, AiInsightPanelDef> = {
  'ai-impact': {
    id: 'ai-impact', icon: '✨', titleKey: 'panel.aiImpact', descKey: 'panel.aiImpactDesc',
    capability: 'insights.aiImpact', width: WIDE, Summary: AiImpactSummary, render: () => <AiImpactLens />,
  },
  engineering: {
    id: 'engineering', icon: '🤖', titleKey: 'panel.engineering', descKey: 'panel.engineeringDesc',
    capability: 'insights.engineering', width: WIDE, Summary: EngineeringSummary, render: () => <EngineeringLens />,
  },
  'llm-usage': {
    id: 'llm-usage', icon: '🪙', titleKey: 'panel.llmUsage', descKey: 'panel.llmUsageDesc',
    capability: 'insights.llmUsage', width: WIDE, Summary: LlmUsageSummary, render: () => <LlmUsageLens />,
  },
  recommendations: {
    id: 'recommendations', icon: '🧠', titleKey: 'panel.recommendations', descKey: 'panel.recommendationsDesc',
    capability: 'insights.recommendations', width: WIDE, Summary: RecommendationsSummary, render: () => <RecommendationsLens />,
  },
};

export const AI_INSIGHT_PANEL_IDS = Object.keys(AI_INSIGHT_PANELS) as AiInsightPanelId[];

export function isAiInsightPanelId(v: unknown): v is AiInsightPanelId {
  return typeof v === 'string' && v in AI_INSIGHT_PANELS;
}
