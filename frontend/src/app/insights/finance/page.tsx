'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LensPage } from '@/components/insights/LensShell';
import { FinanceHub } from '@/components/insights/finance/FinanceHub';

/**
 * `/insights/finance` — the combined Finance hub. Replaces the three separate
 * routes (FinOps spend, Investment Allocation, DevFinOps) with one dashboard
 * whose tiles drill into each lens via a shared slide-out side panel. The retired
 * sub-routes (/finops, /insights/allocation) redirect here with `?drill=<panel>`
 * to open the matching drawer. Each panel gates itself, so the hub is gate=false.
 */
function FinanceInsightsInner() {
  const initialDrill = useSearchParams().get('drill') ?? undefined;
  return (
    <LensPage capability="insights.finance" titleKey="finhub.title" subtitleKey="finhub.subtitle" gate={false}>
      <FinanceHub initialDrill={initialDrill} />
    </LensPage>
  );
}

export default function FinanceInsightsPage() {
  // useSearchParams (the ?drill= deep-link) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <FinanceInsightsInner />
    </Suspense>
  );
}
