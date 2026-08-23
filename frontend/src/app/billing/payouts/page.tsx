import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import BillingClient from '@/components/billing/BillingClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Payouts',
  description: 'Connect a bank account, PayPal or Stripe and review what has been paid out.',
  path: '/billing/payouts',
});

/** The same console, opened on its payouts view — one component, four routes. */
export default function BillingPayoutsPage() {
  return (
    <Suspense fallback={null}>
      <BillingClient view="payouts" />
    </Suspense>
  );
}
