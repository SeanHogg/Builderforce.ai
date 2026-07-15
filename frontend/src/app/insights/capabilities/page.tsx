'use client';

import { Suspense } from 'react';
import { CapabilitiesDashboard } from '@/components/capabilities/CapabilitiesDashboard';

/**
 * Capabilities Dashboard page.
 * Displays health score gauge, status breakdown, category breakdown, and editable/filterable table.
 */
export default function CapabilitiesPage() {
  return (
    <CapabilitiesDashboard />
  );
}