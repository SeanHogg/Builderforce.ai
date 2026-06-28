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

import type { ComponentType, ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { AiImpactLens } from './AiImpactLens';
import { EngineeringLens } from './EngineeringLens';
import { RecommendationsLens } from './RecommendationsLens';
import { AiImpactSummary, EngineeringSummary, RecommendationsSummary } from './AiInsightSummaries';

/** Stable ids (also the `?panel=` deep-link + Brain enum values). */
export type AiInsightPanelId = 'ai-impact' | 'engineering' | 'recommendations';

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
  /** Compact KPI card for the dashboard (reads `days` from the shared window). */
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
  recommendations: {
    id: 'recommendations', icon: '🧠', titleKey: 'panel.recommendations', descKey: 'panel.recommendationsDesc',
    capability: 'insights.recommendations', width: WIDE, Summary: RecommendationsSummary, render: () => <RecommendationsLens />,
  },
};

export const AI_INSIGHT_PANEL_IDS = Object.keys(AI_INSIGHT_PANELS) as AiInsightPanelId[];

export function isAiInsightPanelId(v: unknown): v is AiInsightPanelId {
  return typeof v === 'string' && v in AI_INSIGHT_PANELS;
}
