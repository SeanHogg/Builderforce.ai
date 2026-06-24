'use client';

import { LensPage } from '@/components/insights/LensShell';
import { EngineeringLens } from '@/components/insights/EngineeringLens';

export default function EngineeringInsightsPage() {
  return (
    <LensPage capability="insights.engineering" titleKey="eng.title" subtitleKey="eng.subtitle">
      <EngineeringLens />
    </LensPage>
  );
}
