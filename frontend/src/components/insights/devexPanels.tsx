'use client';

/**
 * Single source of truth for the consolidated DevEx hub's drill-down panels.
 *
 * The DevEx surfaces that used to be two separate tabs — the survey results
 * Insights lens (/insights/devex) and survey management (/surveys) — are declared
 * here once as reusable {@link DevexPanelDef}s: a full lens (the drill-down
 * `render`), a compact dashboard `Summary`, its i18n title/description, and the
 * RBAC capability that gates it. The dashboard renders the summaries and drills
 * into the lenses via a slide-out side panel, and the Brain opens the SAME
 * definitions on demand (see DevexPanelProvider + DevexPanelBrainBridge), so
 * there is exactly one place that knows how to show a DevEx surface. Mirrors the
 * AI hub's aiInsightPanels.tsx.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Capability } from '@/lib/rbac';
import { DevexResultsLens } from './DevexResultsLens';
import { SurveysManager } from './SurveysManager';
import { PulseLens } from './PulseWidget';
import { DevexResultsSummary, DevexSurveysSummary } from './DevexSummaries';

/** Stable ids (also the `?panel=` deep-link + Brain enum values). */
export type DevexPanelId = 'results' | 'surveys' | 'pulse';

export interface DevexPanelDef {
  id: DevexPanelId;
  icon: string;
  /** i18n key under the `insights.devexhub` namespace. */
  titleKey: string;
  /** One-line description (i18n key) — used in the Brain tool spec + dashboard. */
  descKey: string;
  /** Capability that gates this panel's content. */
  capability: Capability;
  /** Drawer width (wide for the chart/table-heavy lenses). */
  width?: string;
  /** Compact KPI card for the dashboard (reads `days` from the shared window). */
  Summary: ComponentType<{ days: number }>;
  /** The full report rendered inside the drill-down slide-out. */
  render: () => ReactNode;
}

const WIDE = 'min(960px, 96vw)';

export const DEVEX_PANELS: Record<DevexPanelId, DevexPanelDef> = {
  results: {
    id: 'results', icon: '🩺', titleKey: 'panel.results', descKey: 'panel.resultsDesc',
    capability: 'insights.devex', width: WIDE, Summary: DevexResultsSummary, render: () => <DevexResultsLens />,
  },
  surveys: {
    id: 'surveys', icon: '📝', titleKey: 'panel.surveys', descKey: 'panel.surveysDesc',
    capability: 'insights.devex', width: WIDE, Summary: DevexSurveysSummary, render: () => <SurveysManager />,
  },
  pulse: {
    id: 'pulse', icon: '💓', titleKey: 'panel.pulse', descKey: 'panel.pulseDesc',
    capability: 'insights.pulse', width: WIDE, Summary: () => null, render: () => <PulseLens />,
  },
};

export const DEVEX_PANEL_IDS = Object.keys(DEVEX_PANELS) as DevexPanelId[];

export function isDevexPanelId(v: unknown): v is DevexPanelId {
  return typeof v === 'string' && v in DEVEX_PANELS;
}
