import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import { InsightsRedirect } from '@/components/insights/InsightsRedirect';

/** Retired — Innovation Funnel is now a panel of the combined /insights/delivery hub.
 *
 * SERVER route entry. The interactive part is the client component below;
 * this module only names it, so a `'use client'` here put the route's own
 * module — and everything it statically imports — into the client bundle for
 * nothing. Removing the directive changes no behaviour: a server component
 * may render a client child, and the child keeps its own directive.
 */
/**
 * The head is decided per request (the teaser copy is localized, and the locale
 * lives in a cookie), so the route is dynamic and next-on-pages requires the
 * Edge Runtime. `check-edge-runtime.mjs` enforces the pairing.
 */
export const runtime = 'edge';

/**
 * The signed-out teaser's head, decided on the SERVER.
 *
 * Every authenticated route renders a marketing teaser to a logged-out visitor,
 * and that teaser used to set its title, description and `noindex` from a
 * `useEffect` — so the HTML a crawler or a link preview actually receives
 * carried the root layout's generic, INDEXABLE head. One shared body
 * (`routeTeaserMetadata`) so the registries are read once.
 */
export async function generateMetadata() {
  return routeTeaserMetadata('/insights/funnel');
}

export default function FunnelInsightsPage() {
  return <InsightsRedirect to="/insights/delivery?panel=funnel" />;
}
