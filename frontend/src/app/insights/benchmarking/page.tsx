'use client';

import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — Benchmarking is now a panel of the combined /insights/delivery hub. */
export default function BenchmarkingInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=benchmarking" />;
}
