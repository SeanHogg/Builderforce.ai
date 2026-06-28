'use client';

import { LensPage } from '@/components/insights/LensShell';
import { AllocationLens } from '@/components/insights/AllocationLens';

export default function AllocationInsightsPage() {
  return (
    <LensPage capability="insights.allocation" titleKey="alloc.title" subtitleKey="alloc.subtitle">
      <AllocationLens />
    </LensPage>
  );
}
