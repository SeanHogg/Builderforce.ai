/**
 * Legacy `/tasks` route. Tasks now live on the consolidated Projects / Tasks page
 * (`/projects`) under the Tasks tab. Redirect there, preserving the `?project=<id>`
 * scope so existing deep links and bookmarks keep working.
 */
import { retiredRoute } from '@/lib/routing/retiredRoute';

// Reading the incoming query string makes this route per-request.
export const runtime = 'edge';

export default retiredRoute(({ project }) => {
  const params = new URLSearchParams({ tab: 'tasks' });
  if (project) params.set('project', project);
  return `/projects?${params.toString()}`;
});
