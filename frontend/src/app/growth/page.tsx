/**
 * Server page that auth-guards through the shared `<RequireAuth>` boundary
 * (mirrors /alerts). Manager-only actions are gated inside GrowthClient — the
 * page itself is readable by any tenant member.
 */
import { RequireAuth } from '@/components/auth/RequireAuth';
import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import { GrowthClient } from './GrowthClient';

/** The head is localized per request (locale cookie), so the route is dynamic. */
export const runtime = 'edge';

/** The sitemap submits this URL from the teaser registry; see `routeTeaserMetadata`. */
export async function generateMetadata() {
  return routeTeaserMetadata('/growth');
}

export default function GrowthPage() {
  return <RequireAuth><GrowthClient /></RequireAuth>;
}
