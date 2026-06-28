'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — SPACE is now a panel of the combined /insights/delivery hub. */
export default function SpaceInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=space" />;
}
