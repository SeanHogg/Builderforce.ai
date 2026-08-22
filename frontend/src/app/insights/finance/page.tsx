import { Suspense } from 'react';
import { FinanceInsightsInner } from './FinanceInsightsInner';

/**
 * `/insights/finance` — the combined Finance hub. Replaces the three separate
 * routes (FinOps spend, Investment Allocation, DevFinOps) with one dashboard
 * whose tiles drill into each lens via a shared slide-out side panel. The retired
 * sub-routes (/finops, /insights/allocation) redirect here with `?drill=<panel>`
 * to open the matching drawer. Each panel gates itself, so the hub is gate=false.
 *
 * A server component: the `?drill=` read that forces the browser lives one file
 * down, in the client leaf.
 */
export default function FinanceInsightsPage() {
  // useSearchParams (the ?drill= deep-link) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <FinanceInsightsInner />
    </Suspense>
  );
}
