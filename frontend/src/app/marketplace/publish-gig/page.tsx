import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import PublishGigClient from './PublishGigClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Publish a gig',
  description: 'Turn a ticket on one of your boards into hireable work on the marketplace.',
  path: '/marketplace/publish-gig',
});

export default function PublishGigPage() {
  return (
    <Suspense fallback={null}>
      <PublishGigClient />
    </Suspense>
  );
}
