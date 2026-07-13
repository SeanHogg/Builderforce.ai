'use client';

import { Suspense } from 'react';
import { LensPage } from '@/components/insights/LensShell';
import { DeliveryDashboard } from '@/components/insights/DeliveryDashboard';

/**
 * `/insights/delivery` — the combined Delivery hub. Replaces the six separate
 * report pages (Delivery, Bottlenecks, DORA, SPACE, Benchmarking, Innovation
 * Funnel) with one dashboard whose tiles drill into each lens via a slide-out.
 * The open panel mirrors to `?panel=<id>` so drawers are deep-linkable (the
 * retired sub-routes redirect here with the matching panel). Each panel gates
 * itself, so the hub is gate=false.
 */
export default function DeliveryInsightsPage() {
  return (
    <LensPage capability="insights.delivery" titleKey="delivhub.title" subtitleKey="delivhub.subtitle" gate={false}>
      {/* useSearchParams (the ?panel= deep-link) requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <DeliveryDashboard />
      </Suspense>
    </LensPage>
  );
}
