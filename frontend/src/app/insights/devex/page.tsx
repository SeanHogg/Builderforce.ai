'use client';

import { Suspense } from 'react';
import { LensPage } from '@/components/insights/LensShell';
import { DevexDashboard } from '@/components/insights/DevexDashboard';

/**
 * `/insights/devex` — the combined DevEx hub. Replaces the two separate tabs
 * (DevEx survey results and the standalone /surveys management page) with one
 * dashboard whose sections drill into each lens via a slide-out. The open panel
 * mirrors to `?panel=<id>` so drawers are deep-linkable (the retired /surveys
 * route redirects here with the surveys panel). Each panel gates itself, so the
 * hub is gate=false.
 */
export default function DevexInsightsPage() {
  return (
    <LensPage capability="insights.devex" titleKey="devexhub.title" subtitleKey="devexhub.subtitle" gate={false}>
      {/* useSearchParams (the ?panel= deep-link) requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <DevexDashboard />
      </Suspense>
    </LensPage>
  );
}
