import { Suspense } from 'react';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import RouteTeaserJsonLd from '@/components/marketing/RouteTeaserJsonLd';
import { BrainstormCanvasRedirect } from './BrainstormCanvasRedirect';

/** The head is localized per request (locale cookie), so the route is dynamic. */
export const runtime = 'edge';

/** The sitemap submits this URL from the teaser registry; see `routeTeaserMetadata`. */
export async function generateMetadata() {
  return routeTeaserMetadata('/brainstorm');
}

/** Server page; the session-dependent forward runs in the client leaf beside it. */
export default function BrainstormCompatibilityPage() {
  return (
    <>
      <RouteTeaserJsonLd pathname="/brainstorm" />
      <Suspense fallback={null}><BrainstormCanvasRedirect /></Suspense>
    </>
  );
}
