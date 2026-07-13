import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * Ceremonies is a project sub-view — it now lives as the "Ceremonies" tab of
 * Projects. Preserve the old URL.
 */
export default function CeremoniesRedirect() {
  redirect('/projects?tab=ceremonies');
}
