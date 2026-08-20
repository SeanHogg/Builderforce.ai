import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import { LensPage } from '@/components/insights/LensShell';
import { AutonomyLens } from '@/components/insights/AutonomyLens';

/**
 * `/insights/autonomy` — the Autonomy Health report: per-origin lifecycle funnel
 * (Created → dispatched → progressed → Done → fully autonomous), the
 * autonomous-vs-human hop split, and the gates where autonomy dies.
 *
 * A standalone lens route (like /insights/compliance) rather than a hub, and ALSO
 * registered as a drill-down panel of the Delivery hub so the dashboard cards and
 * the Brain can open the same lens in a slide-out. The lens itself is the client
 * component; this entry is a server module, so the route prerenders statically
 * and needs no `runtime` export — the data comes from the API on the client.
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
  return routeTeaserMetadata('/insights/autonomy');
}

export default function AutonomyInsightsPage() {
  return (
    <LensPage capability="insights.autonomy" titleKey="autonomy.title" subtitleKey="autonomy.subtitle">
      <AutonomyLens />
    </LensPage>
  );
}
