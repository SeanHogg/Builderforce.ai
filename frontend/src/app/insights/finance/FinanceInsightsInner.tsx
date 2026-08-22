'use client';

import { useSearchParams } from 'next/navigation';
import { LensPage } from '@/components/insights/LensShell';
import { FinanceHub } from '@/components/insights/finance/FinanceHub';

/**
 * The client leaf of `/insights/finance`: the only thing here that has to run in
 * the browser is reading the `?drill=` deep link. It stays a CLIENT read rather
 * than moving up to the server page's `searchParams`, because FinanceHub mirrors
 * the open drawer back into the query — served from the server, every drawer
 * open would become a round trip.
 */
export function FinanceInsightsInner() {
  const initialDrill = useSearchParams().get('drill') ?? undefined;
  return (
    <LensPage capability="insights.finance" titleKey="finhub.title" subtitleKey="finhub.subtitle" gate={false}>
      <FinanceHub initialDrill={initialDrill} />
    </LensPage>
  );
}
