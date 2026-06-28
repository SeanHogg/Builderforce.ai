'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — Recommendations is now a section of the combined /insights/ai dashboard. */
export default function RecommendationsInsightsPage() {
  return <InsightsRedirect to="/insights/ai?panel=recommendations" />;
}
