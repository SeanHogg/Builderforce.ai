import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import BillingClient from '@/components/billing/BillingClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Billing',
  description: 'Manage your plan, payment method, payout destinations and payout history.',
  path: '/billing',
});

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingClient />
    </Suspense>
  );
}
