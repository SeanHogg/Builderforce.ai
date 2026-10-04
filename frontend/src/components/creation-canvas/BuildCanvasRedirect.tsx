'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchProject } from '@/lib/api';
import { fetchIdeProjectByStorage } from '@/lib/ideProjectsApi';
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
    const toBuildList = () => { if (!cancelled) router.replace('/create?filter=build'); };
    void (async () => {
      const project = await fetchProject(projectRef);
      if (namesProjectChat(chatLink)) {
        if (!cancelled) router.replace(studioChatHref(project.id, chatLink));
        return;
      }
      // No build record (a project started in Studio) is an answer, not an error.
      const build = await fetchIdeProjectByStorage(project.id);
      if (!build) return toBuildList();
      const opened = await creationSessionsApi.openIdeProject(build.id);
      if (cancelled) return;
      router.replace(openedBoardHref(opened, {
        build: '1',
        prompt: searchParams.get('prompt'),
      }));
    })().catch(toBuildList);
    return () => { cancelled = true; };
  }, [projectRef, router, searchParams]);

  return null;
}
