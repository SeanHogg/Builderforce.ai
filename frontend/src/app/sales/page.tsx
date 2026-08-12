import { Suspense } from 'react';
import type { Metadata } from 'next';
import SalesHubClient from '@/components/sales/SalesHubClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Sales Hub',
  description: 'Referral links, leads, reports, payouts, inbox and the sales kit — the associate hub.',
};

/**
 * The associate's hub. NOT the launcher — that lives at `/sales/canvas`, where a
 * post-sign-in landing belongs. This route opens as a slide-out panel over the
 * board (see `workbenchPolicy`), which is what makes the "Sales Hub" menu item a
 * thing you consult rather than a navigation that costs you your canvas.
 */
export default function SalesPage() {
  return (
    <Suspense fallback={null}>
      <SalesHubClient />
    </Suspense>
  );
}
