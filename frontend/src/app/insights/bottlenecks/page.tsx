'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — Bottlenecks is now a panel of the combined /insights/delivery hub. */
export default function BottlenecksInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=bottlenecks" />;
}
