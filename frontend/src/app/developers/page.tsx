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

export default function DevelopersPage() {
  return <DeveloperPortalContent />;
}
