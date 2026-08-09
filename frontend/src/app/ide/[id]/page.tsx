'use client';

export const runtime = 'edge';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { fetchIdeProjectByStorage, fetchProject } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';

/**
 * Compatibility adapter for old IDE deep links.
 *
 * The IDE is no longer a page. Resolve its storage-project URL to the canonical
 * IDE project, open the project's Builder object in a Creation Session, and ask
 * the canvas to open that object's workspace immediately.
 */
export default function IDECanvasRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    let cancelled = false;

    void fetchProject(id)
      .then((project) => fetchIdeProjectByStorage(project.id))
      .then((build) => creationSessionsApi.openIdeProject(build.id))
      .then((opened) => {
        if (cancelled) return;
        const next = new URLSearchParams({ focus: opened.objectId, build: '1' });
        const prompt = searchParams.get('prompt');
        if (prompt) next.set('prompt', prompt);
        router.replace(`/create/${opened.sessionId}?${next.toString()}`);
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=build');
      });

    return () => { cancelled = true; };
  }, [params, router, searchParams]);

  return null;
}
