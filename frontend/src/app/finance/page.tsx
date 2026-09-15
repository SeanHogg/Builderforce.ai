import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import FinanceClient from '@/components/finance/FinanceClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Finance',
  description:
    'Runway and cashflow for the company you run: the burn, revenue and cash the platform has observed, beside the numbers you declared, each labelled with where it came from.',
  path: '/finance',
});

/**
 * `/finance` — the CFO's destination (PRD 19 B1).
 *
 * A Server Component wrapper over one client entry, matching `/investor` and
 * `/hiring`: the route boundary stays on the server and exactly one file crosses
 * into the client bundle. The `Suspense` boundary is load-bearing for the same
 * reason `/investor` documents — `FinanceClient` reads `?tab=` and `?company=`
 * through `useSearchParams()`.
 *
 * `/seat/finance` is still the generic entity browser over the same domain and
 * is still reachable; it lists the tables. This is the destination.
 */
export default function FinancePage() {
  return (
    <Suspense fallback={null}>
      <FinanceClient />
    </Suspense>
  );
}
