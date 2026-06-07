'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Legacy `/tasks` route. Tasks now live on the consolidated Projects / Tasks page
 * (`/projects`) under the Tasks tab. Redirect here, preserving the `?project=<id>`
 * scope so existing deep links and bookmarks keep working.
 */
export default function TasksRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const project = searchParams.get('project');
    const params = new URLSearchParams({ tab: 'tasks' });
    if (project) params.set('project', project);
    router.replace(`/projects?${params.toString()}`);
  }, [router, searchParams]);

  return null;
}
