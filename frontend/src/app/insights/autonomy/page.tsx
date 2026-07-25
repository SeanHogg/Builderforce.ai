'use client';

import { LensPage } from '@/components/insights/LensShell';
import { AutonomyLens } from '@/components/insights/AutonomyLens';

/**
 * `/insights/autonomy` — the Autonomy Health report: per-origin lifecycle funnel
 * (Created → dispatched → progressed → Done → fully autonomous), the
 * autonomous-vs-human hop split, and the gates where autonomy dies.
 *
 * A standalone lens route (like /insights/compliance) rather than a hub, and ALSO
 * registered as a drill-down panel of the Delivery hub so the dashboard cards and
 * the Brain can open the same lens in a slide-out. Client-rendered like every
 * sibling insights page, so it prerenders statically and needs no `runtime`
 * export — the data comes from the API at request time on the client.
 */
export default function AutonomyInsightsPage() {
  return (
    <LensPage capability="insights.autonomy" titleKey="autonomy.title" subtitleKey="autonomy.subtitle">
      <AutonomyLens />
    </LensPage>
  );
}
