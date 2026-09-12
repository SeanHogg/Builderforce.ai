import { Suspense } from 'react';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import { WorkflowsPageBody } from './WorkflowsPageBody';

/** The head is localized per request (locale cookie), so the route is dynamic. */
export const runtime = 'edge';

/** The sitemap submits this URL from the teaser registry; see `routeTeaserMetadata`. */
export async function generateMetadata() {
  return routeTeaserMetadata('/workflows');
}

/** A server component; the `?projectId=` read lives in the client leaf beside it. */
export default function WorkflowsPage() {
  return (
    <main style={{ padding: '24px 24px 48px', maxWidth: 1200, margin: '0 auto' }}>
      <RouteTeaserJsonLd pathname="/workflows" />
      <Suspense fallback={null}>
        <WorkflowsPageBody />
      </Suspense>
    </main>
  );
}
