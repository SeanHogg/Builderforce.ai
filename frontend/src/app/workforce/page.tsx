import { Suspense } from 'react';
import { WorkforceTabs } from './WorkforceTabs';

/**
 * Server page. The `?tab=` read that selects the sub-view is a client concern —
 * switching tabs must stay an instant client-side navigation — so it lives in the
 * leaf beside this file rather than making the route itself a client component.
 */
export default function WorkforcePage() {
  // useSearchParams requires a Suspense boundary under the App Router.
  return (
    <Suspense fallback={null}>
      <WorkforceTabs />
    </Suspense>
  );
}
