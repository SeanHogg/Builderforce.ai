'use client';

import { useRouter } from 'next/navigation';
import { useOptionalAiInsightPanel } from '@/components/insights/AiInsightPanelProvider';
import { useOptionalDeliveryPanel } from '@/components/insights/DeliveryPanelProvider';
import { useOptionalFinancePanel } from '@/components/insights/finance/FinancePanelProvider';
import { useOptionalDevexPanel } from '@/components/insights/DevexPanelProvider';
import type { WidgetDrill } from '@/lib/widgets/types';

/**
 * Dispatch a widget's drill-down to the full report.
 *
 * An insights widget opens its source hub's slide-out lens IN PLACE, so the
 * report appears over whatever you were looking at and `Esc` gives it back. All
 * four hub providers are mounted app-wide (see ConditionalAppShell), so this
 * works from a lens, the home dashboard, a shared dashboard or a canvas alike.
 * Only `ai` used to be handled here — a pinned DORA or finance card therefore
 * NAVIGATED to the hub route, which is precisely the "consulting a number costs
 * you your place" behaviour the panel model exists to remove.
 *
 * The route push remains as the fallback for a surface that somehow renders
 * outside the providers: the hub deep-link auto-opens the same panel on arrival.
 * Route widgets (non-insights surfaces) just navigate.
 */

/** Hub id → the route whose `?panel=`/`?drill=` deep-link opens the same lens. */
const HUB_ROUTE: Record<string, string> = {
  ai: '/insights/ai',
  delivery: '/insights/delivery',
  finance: '/insights/finance',
  devex: '/insights/devex',
};

export function useWidgetDrill(): (drill: WidgetDrill | undefined) => void {
  const router = useRouter();
  const ai = useOptionalAiInsightPanel();
  const delivery = useOptionalDeliveryPanel();
  const finance = useOptionalFinancePanel();
  const devex = useOptionalDevexPanel();

  return (drill) => {
    if (!drill) return;
    if (drill.kind === 'route') { router.push(drill.href); return; }

    // In-place slide-out when the hub's provider is reachable. Each provider's
    // `open` takes its own panel-id union; the drill carries the id as a string
    // because the registry is hub-agnostic, so the cast happens once, here.
    const open: Record<string, ((panel: string) => void) | undefined> = {
      ai: ai ? (panel) => ai.open(panel as Parameters<typeof ai.open>[0]) : undefined,
      delivery: delivery ? (panel) => delivery.open(panel as Parameters<typeof delivery.open>[0]) : undefined,
      finance: finance ? (panel) => finance.open(panel as Parameters<typeof finance.open>[0]) : undefined,
      devex: devex ? (panel) => devex.open(panel as Parameters<typeof devex.open>[0]) : undefined,
    };
    const openHub = open[drill.hub];
    if (openHub) { openHub(drill.panel); return; }

    // Fallback: deep-link route that auto-opens the panel on arrival.
    const param = drill.hub === 'finance' ? 'drill' : 'panel';
    router.push(`${HUB_ROUTE[drill.hub] ?? HUB_ROUTE.ai}?${param}=${drill.panel}`);
  };
}
