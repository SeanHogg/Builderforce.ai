import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import LtiLaunchClient from './LtiLaunchClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'LMS launch',
  description: 'Where a launch from a connected learning management system lands.',
  path: '/lti/launch',
});

export default function LtiLaunchPage() {
  return (
    <Suspense fallback={null}>
      <LtiLaunchClient />
    </Suspense>
  );
}
