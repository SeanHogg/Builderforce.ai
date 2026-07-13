'use client';

import { LensPage } from '@/components/insights/LensShell';
import { ComplianceLens } from '@/components/insights/ComplianceLens';

export default function ComplianceInsightsPage() {
  return (
    <LensPage capability="insights.compliance" titleKey="comp.title" subtitleKey="comp.subtitle">
      <ComplianceLens />
    </LensPage>
  );
}
