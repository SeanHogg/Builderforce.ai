'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — AI Impact is now a section of the combined /insights/ai dashboard. */
export default function AiImpactInsightsPage() {
  return <InsightsRedirect to="/insights/ai?panel=ai-impact" />;
}
