'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — Innovation Funnel is now a panel of the combined /insights/delivery hub. */
export default function FunnelInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=funnel" />;
}
