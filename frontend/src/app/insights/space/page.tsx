'use client';

import { LensPage } from '@/components/insights/LensShell';
import { SpaceLens } from '@/components/insights/SpaceLens';

export default function SpaceInsightsPage() {
  return (
    <LensPage capability="insights.delivery" titleKey="space.title" subtitleKey="space.subtitle">
      <SpaceLens />
    </LensPage>
  );
}
