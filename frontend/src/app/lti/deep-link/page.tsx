import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import DeepLinkPickerClient from './DeepLinkPickerClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Add course content',
  description: 'Choose what a connected learning management system links to.',
  path: '/lti/deep-link',
});

export default function LtiDeepLinkPage() {
  return (
    <Suspense fallback={null}>
      <DeepLinkPickerClient />
    </Suspense>
  );
}
