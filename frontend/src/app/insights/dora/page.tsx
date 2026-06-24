'use client';

import { LensPage } from '@/components/insights/LensShell';
import { DoraLens } from '@/components/insights/DoraLens';

export default function DoraInsightsPage() {
  return (
    <LensPage capability="insights.delivery" titleKey="dora.title" subtitleKey="dora.subtitle">
      <DoraLens />
    </LensPage>
  );
}
