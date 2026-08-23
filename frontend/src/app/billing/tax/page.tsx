import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import BillingClient from '@/components/billing/BillingClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Tax',
  description: 'Submit your W-9/W-8 tax profile, and — for managers — the year-end 1099 report.',
  path: '/billing/tax',
});

/** The same console, opened on the tax view — one component, four routes. */
export default function BillingTaxPage() {
  return (
    <Suspense fallback={null}>
      <BillingClient view="tax" />
    </Suspense>
  );
}
