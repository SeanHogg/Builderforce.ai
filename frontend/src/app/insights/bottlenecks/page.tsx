'use client';

import { LensPage } from '@/components/insights/LensShell';
import { BottleneckLens } from '@/components/insights/BottleneckLens';

export default function BottleneckInsightsPage() {
  return (
    <LensPage capability="insights.delivery" titleKey="bottleneck.title" subtitleKey="bottleneck.subtitle">
      <BottleneckLens />
    </LensPage>
  );
}
