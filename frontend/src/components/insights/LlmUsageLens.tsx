'use client';

import { LlmUsageContent } from '@/components/LlmUsageContent';
import { ModelRoutingAnalytics } from '@/components/ModelRoutingAnalytics';

/**
 * LENS — "LLM Usage": the full LLM report that used to be its own /workforce tab,
 * now the `llm-usage` drill-down inside the consolidated AI Insights hub.
 *
 * Provider/model health, usage totals, the cost-bearing by-source / project /
 * user / team / repo breakdowns, and the learned model-routing table render here
 * in the slide-out side panel. The headline metrics are ALSO available as
 * individually-pinnable widgets (see llmUsageWidgets.tsx) that drill back into
 * this same lens. One shared registry, one place that knows how to show LLM usage.
 */
export function LlmUsageLens() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <LlmUsageContent />
      <ModelRoutingAnalytics />
    </div>
  );
}
