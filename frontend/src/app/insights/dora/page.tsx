'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — DORA is now a panel of the combined /insights/delivery hub. */
export default function DoraInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=dora" />;
}
