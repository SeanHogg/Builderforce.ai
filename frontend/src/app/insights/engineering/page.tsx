'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — AI Effectiveness is now a section of the combined /insights/ai dashboard. */
export default function EngineeringInsightsPage() {
  return <InsightsRedirect to="/insights/ai?panel=engineering" />;
}
