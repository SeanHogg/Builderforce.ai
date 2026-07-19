import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * Kanban Templates is a project sub-view — it now lives as the "Templates" tab of
 * Projects. Preserve the old URL.
 */
export default function KanbanTemplatesRedirect() {
  redirect('/projects?tab=templates');
}
