'use client';

import { useRouter } from 'next/navigation';
import { useOptionalAiInsightPanel } from '@/components/insights/AiInsightPanelProvider';
import type { WidgetDrill } from '@/lib/widgets/types';

/**
 * Dispatch a widget's drill-down to the full report.
 *
 * For an insights widget we open the source hub's slide-out lens IN PLACE (so the
 * drill-down appears over the current dashboard, per the spec) when that hub's
 * provider is mounted; otherwise we deep-link to the hub route, which auto-opens
 * the same panel. Route widgets (non-insights surfaces) just navigate. One hook
 * so every WidgetCard drills the same way regardless of where it's rendered.
 */
export function useWidgetDrill(): (drill: WidgetDrill | undefined) => void {
  const router = useRouter();
  const ai = useOptionalAiInsightPanel();

  return (drill) => {
    if (!drill) return;
    if (drill.kind === 'route') { router.push(drill.href); return; }

    // In-place slide-out when the hub provider is reachable.
    if (drill.hub === 'ai' && ai) { ai.open(drill.panel as Parameters<typeof ai.open>[0]); return; }

    // Fallback: deep-link route that auto-opens the panel on arrival.
    const base: Record<string, string> = {
      ai: '/insights/ai', delivery: '/insights/delivery', finance: '/insights/finance', devex: '/insights/devex',
    };
    const param = drill.hub === 'finance' ? 'drill' : 'panel';
    router.push(`${base[drill.hub] ?? '/insights/ai'}?${param}=${drill.panel}`);
  };
}
