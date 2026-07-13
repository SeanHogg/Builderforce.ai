import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * The standalone "Custom Dashboards" page was absorbed into the unified Insights
 * home (/insights) — there is one dashboard surface, not two. This route stays as
 * a redirect so old links/bookmarks keep working.
 */
export default function DashboardsPage() {
  redirect('/insights');
}
