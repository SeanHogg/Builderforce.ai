/**
 * `/developers` — the Developer Portal (PRD 24).
 *
 * A SERVER component that renders one client island. The interactive work all
 * lives in `DeveloperPortalContent`; there is nothing on this route that needs a
 * client-rooted page, and rooting it here would put the whole subtree in the
 * client bundle for the sake of a wrapper (`npm run check:architecture` counts
 * exactly that).
 */
import { DeveloperPortalContent } from '@/components/developer/DeveloperPortalContent';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';

/** The head is localized per request (locale cookie), so the route is dynamic. */
export const runtime = 'edge';

/** The sitemap submits this URL from the teaser registry; see `routeTeaserMetadata`. */
export async function generateMetadata() {
  return routeTeaserMetadata('/developers');
}

export default function DevelopersPage() {
  return <DeveloperPortalContent />;
}
