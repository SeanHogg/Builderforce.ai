import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import BillingClient from '@/components/billing/BillingClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Get paid',
  description: 'Connect a merchant account so customers can pay your invoices by card, and see what is still outstanding.',
  path: '/billing/get-paid',
});

/** The same console, opened on the money-IN view — one component, four routes. */
export default function BillingGetPaidPage() {
  return (
    <Suspense fallback={null}>
      <BillingClient view="getPaid" />
    </Suspense>
  );
}
