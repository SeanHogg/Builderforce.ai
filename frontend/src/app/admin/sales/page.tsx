import { Suspense } from 'react';
import type { Metadata } from 'next';
import AdminSalesClient from '@/components/sales/AdminSalesClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Sales programme',
  description: 'Aggregate sales-programme reporting across every associate, filterable to one.',
};

/**
 * The owner's revenue view. `/admin/sales`, deliberately separate from `/sales`:
 * that route is the ASSOCIATE's hub and carries their own referral links, which
 * a platform owner does not have. Opens as a panel over the board like every
 * other admin destination.
 */
export default function AdminSalesPage() {
  return (
    <Suspense fallback={null}>
      <AdminSalesClient />
    </Suspense>
  );
}
