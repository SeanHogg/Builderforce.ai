'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchIdeProjectByStorage, fetchProject } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';

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
        const next = new URLSearchParams({ focus: opened.objectId, build: '1' });
        for (const key of ['prompt', 'chat', 'ticket'] as const) {
          const value = searchParams.get(key);
          if (value) next.set(key, value);
        }
        router.replace(`/create/${opened.sessionId}?${next.toString()}`);
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=build');
      });
    return () => { cancelled = true; };
  }, [projectRef, router, searchParams]);

  return null;
}
