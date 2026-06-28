'use client';

import { LensPage } from '@/components/insights/LensShell';
import { DeliveryLens } from '@/components/insights/DeliveryLens';

export default function DeliveryInsightsPage() {
  return (
    <LensPage capability="insights.delivery" titleKey="deliv.title" subtitleKey="deliv.subtitle">
      <DeliveryLens />
    </LensPage>
  );
}
