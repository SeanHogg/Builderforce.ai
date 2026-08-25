import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import InvestorClient from '@/components/investor/InvestorClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Investors',
  description:
    'The raise as a place: the company and the work attached to it, the round, the investors invited to the company rather than to a room, the data room, the diligence still open and the fundraising pack.',
  path: '/investor',
});

/**
 * `/investor` — the CEO's raise (IN-3).
 *
 * A Server Component wrapper over one client entry, matching `/hiring` and every
 * other destination: the route boundary stays on the server and exactly one file
 * crosses into the client bundle.
 *
 * The `Suspense` boundary is load-bearing rather than decorative — `InvestorClient`
 * reads `?tab=` and `?company=` through `useSearchParams()`, which opts every tree
 * above it into a Suspense requirement. Without one the build fails outright on a
 * statically prerendered ancestor, which is the exact failure `ShellIndex` documents
 * for the same hook.
 *
 * `/seat/investor` is still the generic entity browser over the same domain and is
 * still reachable; it lists the tables. This is the destination.
 */
export default function InvestorPage() {
  return (
    <Suspense fallback={null}>
      <InvestorClient />
    </Suspense>
  );
}
