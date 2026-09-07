'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchIdeProjectByStorage, fetchProject } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';

/** Resolve a legacy storage-project reference into its Builder object on Canvas. */
export function BuildCanvasRedirect({ projectRef }: { projectRef: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!projectRef) return;
    let cancelled = false;
    void fetchProject(projectRef)
      .then((project) => fetchIdeProjectByStorage(project.id))
      .then((build) => creationSessionsApi.openIdeProject(build.id))
      .then((opened) => {
        if (cancelled) return;
        router.replace(openedBoardHref(opened, {
          build: '1',
          prompt: searchParams.get('prompt'),
          chat: searchParams.get('chat'),
          ticket: searchParams.get('ticket'),
        }));
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=build');
      });
    return () => { cancelled = true; };
  }, [projectRef, router, searchParams]);

  return null;
}
