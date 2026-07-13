import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * Portfolio / PMO is a sub-view of Projects, not its own menu item — it now
 * lives as the "Portfolio" tab of Projects. Preserve the old URL.
 */
export default function PmoRedirect() {
  redirect('/projects?tab=portfolio');
}
