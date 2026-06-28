'use client';

import { LensPage } from '@/components/insights/LensShell';
import { DevexLens } from '@/components/insights/DevexLens';

export default function DevexInsightsPage() {
  return (
    <LensPage capability="insights.devex" titleKey="devex.title" subtitleKey="devex.subtitle">
      <DevexLens />
    </LensPage>
  );
}
