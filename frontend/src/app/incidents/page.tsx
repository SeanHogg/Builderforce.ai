import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import IncidentsPageClient from './IncidentsPageClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Incidents',
  description: 'Live incident war rooms, on-call rotations, escalation policies, and a business-contact directory.',
  path: '/incidents',
});

export default function IncidentsPage() {
  return (
    <Suspense fallback={null}>
      <IncidentsPageClient />
    </Suspense>
  );
}
