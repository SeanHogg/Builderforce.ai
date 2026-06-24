'use client';

import { LensPage } from '@/components/insights/LensShell';
import { FunnelLens } from '@/components/insights/FunnelLens';

export default function FunnelInsightsPage() {
  return (
    <LensPage capability="insights.portfolio" titleKey="funnel.title" subtitleKey="funnel.subtitle">
      <FunnelLens />
    </LensPage>
  );
}
