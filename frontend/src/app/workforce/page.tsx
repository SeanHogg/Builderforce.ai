import { Suspense } from 'react';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import { WorkforceTabs } from './WorkforceTabs';

/** The head is localized per request (locale cookie), so the route is dynamic. */
export const runtime = 'edge';

/** The sitemap submits this URL from the teaser registry; see `routeTeaserMetadata`. */
export async function generateMetadata() {
  return routeTeaserMetadata('/workforce');
}

/**
 * Server page. The `?tab=` read that selects the sub-view is a client concern —
 * switching tabs must stay an instant client-side navigation — so it lives in the
 * leaf beside this file rather than making the route itself a client component.
 */
export default function WorkforcePage() {
  // useSearchParams requires a Suspense boundary under the App Router.
  return (
    <>
      <RouteTeaserJsonLd pathname="/workforce" />
      <Suspense fallback={null}>
        <WorkforceTabs />
      </Suspense>
    </>
  );
}
