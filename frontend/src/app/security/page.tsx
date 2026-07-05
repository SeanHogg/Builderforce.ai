import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import SecurityClient from '@/components/security/SecurityClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Security',
  description: 'Govern workspace members, security agents, and SOC 2 audits.',
  path: '/security',
});

export default function SecurityPage() {
  return (
    <Suspense fallback={null}>
      <SecurityClient />
    </Suspense>
  );
}
