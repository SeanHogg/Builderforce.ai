'use client';

import { LensPage } from '@/components/insights/LensShell';
import { FinanceLens } from '@/components/insights/FinanceLens';

export default function FinanceInsightsPage() {
  return (
    <LensPage capability="insights.finance" titleKey="fin.title" subtitleKey="fin.subtitle">
      <FinanceLens />
    </LensPage>
  );
}
