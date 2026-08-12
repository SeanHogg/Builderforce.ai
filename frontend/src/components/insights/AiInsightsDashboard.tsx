'use client';

/**
 * Consolidated AI Insights hub — the single entry point at /insights/ai that
 * replaces the three separate routes (AI Impact, AI Effectiveness and
 * Recommendations). It shows an at-a-glance card for each, and every card drills
 * down into the full lens in the shared slide-out side panel (see
 * AiInsightPanelProvider). Mirrors the Delivery and DevEx hubs.
 *
 * ── It is a standard page, and its cards are REGISTRY WIDGETS ────────────────
 * This used to be a `WorkspaceCanvas`: floating, absolutely-positioned panels
 * with hard-coded x/y coordinates, which meant the hub's content existed only
 * here and could not be pinned, shared or dropped on a board. The hub is now a
 * responsive {@link WidgetGrid} over ids from the app-wide widget registry (see
 * hubWidgets.tsx). Consequences that matter:
 *   • every tile carries its own pin, so any of them can go on a user's home
 *     dashboard, a shared dashboard or a custom canvas;
 *   • the grid reflows instead of overflowing, so the hub reads at 360px and
 *     inside the 70vw workbench panel alike;
 *   • the layout is the registry's size hints, not a coordinate table nobody
 *     dares renumber.
 *
 * The three `/ai-overview`-backed tiles share ONE round-trip through the deduped
 * source layer (insightsSources.ts) rather than being handed a bundled slice by
 * this component — so the single request survives being pinned somewhere else.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { DaysWindowSelect } from './LensShell';
import { useAiInsightPanel } from './AiInsightPanelProvider';
import { isAiInsightPanelId, type AiInsightPanelId } from './aiInsightPanels';
import { AI_HUB_WIDGET_IDS } from './widgets/hubWidgets';

export function AiInsightsDashboard() {
  const [days, setDays] = useState(30);
  const { open } = useAiInsightPanel();
  const searchParams = useSearchParams();

  // Deep-link: /insights/ai?panel=engineering (and the redirects from the
  // retired /insights/ai-impact, /engineering, /recommendations routes)
  // auto-open the drill-down.
  const panelParam = searchParams?.get('panel');
  useEffect(() => {
    if (isAiInsightPanelId(panelParam)) open(panelParam as AiInsightPanelId);
  }, [panelParam, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>
      <WidgetGrid ids={AI_HUB_WIDGET_IDS} days={days} />
    </div>
  );
}
