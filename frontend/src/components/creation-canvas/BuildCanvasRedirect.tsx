'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchIdeProjectByStorage, fetchProject } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { namesProjectChat, studioChatHref, studioChatLinkFrom } from '@/lib/studio/studioDeepLink';

/**
 * Resolve a legacy storage-project reference into its Builder object on Canvas — the App
 * surface, on that object. A link that names a project CHAT opens Studio instead, where
 * project chats live beside the editor (`lib/studio/studioDeepLink.ts`).
 */
export function BuildCanvasRedirect({ projectRef }: { projectRef: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!projectRef) return;
    let cancelled = false;
    const chatLink = studioChatLinkFrom(searchParams);
    void fetchProject(projectRef)
      .then((project) => {
        if (namesProjectChat(chatLink)) {
          if (!cancelled) router.replace(studioChatHref(project.id, chatLink));
          return null;
        }
        return fetchIdeProjectByStorage(project.id);
      })
      .then((build) => (build ? creationSessionsApi.openIdeProject(build.id) : null))
      .then((opened) => {
        if (cancelled || !opened) return;
        router.replace(openedBoardHref(opened, {
          build: '1',
          prompt: searchParams.get('prompt'),
        }));
      })
      .catch(() => {
        if (!cancelled) router.replace('/create?filter=build');
      });
    return () => { cancelled = true; };
  }, [projectRef, router, searchParams]);

  return null;
}
