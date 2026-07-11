import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import MonitoringPageClient from './MonitoringPageClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Active Monitoring',
  description: 'Overlay monitor pins on an architecture diagram; a breach opens an incident. Plus incident + monitor reporting.',
  path: '/monitoring',
});

export default function MonitoringPage() {
  return (
    <Suspense fallback={null}>
      <MonitoringPageClient />
    </Suspense>
  );
}
