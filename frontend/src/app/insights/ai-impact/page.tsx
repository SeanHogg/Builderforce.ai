'use client';

import { LensPage } from '@/components/insights/LensShell';
import { AiImpactLens } from '@/components/insights/AiImpactLens';

export default function AiImpactInsightsPage() {
  return (
    <LensPage capability="insights.aiImpact" titleKey="aiImpact.title" subtitleKey="aiImpact.subtitle">
      <AiImpactLens />
    </LensPage>
  );
}
