'use client';

import { LensPage } from '@/components/insights/LensShell';
import { RecommendationsLens } from '@/components/insights/RecommendationsLens';

export default function RecommendationsInsightsPage() {
  return (
    <LensPage capability="insights.recommendations" titleKey="recs.title" subtitleKey="recs.subtitle">
      <RecommendationsLens />
    </LensPage>
  );
}
