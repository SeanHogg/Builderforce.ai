import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { brain, reposApi, runtimeApi, type ProjectRepository } from '@/lib/builderforceApi';
import type { RepoFileSource } from '@/components/brain/RepoContextPicker';

/**
 * "Add context" from a connected repo: when the active chat's project has one
 * or more repositories, the composer's + menu offers a repo file picker whose
 * selection is attached as context. Same repo the agent clones from, so it
 * works both for planning chats and for chatting with a running agent.
 */
export function useBrainRepoContext({ repoProjectId, activeChatId, attach }: {
  /**
   * The project whose repos back "Add context" — the active chat's project takes
   * precedence (a chat can be assigned to a different project than the viewport),
   * then the IDE-pinned / viewing project.
   */
  repoProjectId: number | null;
  activeChatId: number | null;
  /** The conversation's attach — a picked file rides the next turn as context. */
  attach: (file: File) => Promise<unknown> | unknown;
}) {
  const tRepo = useTranslations('repoContext');
  const [projectRepos, setProjectRepos] = useState<ProjectRepository[]>([]);
  const [linkedTaskId, setLinkedTaskId] = useState<number | null>(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);

  // Repos are fetched from the cached list endpoint; the picker only appears when
  // at least one repo is connected.
  useEffect(() => {
    if (repoProjectId == null) { setProjectRepos([]); return; }
    let live = true;
    reposApi.list(repoProjectId)
      .then((r) => { if (live) setProjectRepos(r); })
      .catch(() => { if (live) setProjectRepos([]); });
    return () => { live = false; };
  }, [repoProjectId]);

  // The task this chat is tied to (if any) — so "Add context" can also list the
  // AGENT WORKING BRANCH (the ticket branch a run commits to), which is the point
  // of chatting with an agent: reference the file it's actually editing. A chat is
  // linked to at most one task in practice; take the first live task link.
  useEffect(() => {
    const cid = activeChatId;
    if (cid == null) { setLinkedTaskId(null); return; }
    let live = true;
    brain.listChatTickets(cid)
      .then((links) => {
        if (!live) return;
        const task = links.find((l) => l.kind === 'task' && l.exists);
        setLinkedTaskId(task ? Number(task.ref) : null);
      })
      .catch(() => { if (live) setLinkedTaskId(null); });
    return () => { live = false; };
  }, [activeChatId]);

  // The file sources "Add context" can browse: the agent's working branch first
  // (most relevant when chatting with a running agent), then each connected repo's
  // default branch. Each source loads its manifest server-side (token stays there).
  const contextSources = useMemo<RepoFileSource[]>(() => {
    const list: RepoFileSource[] = [];
    if (linkedTaskId != null) {
      list.push({
        id: `task:${linkedTaskId}`,
        label: tRepo('agentBranch'),
        load: async () => {
          const r = await runtimeApi.taskRepoFiles(linkedTaskId);
          if (!r.ok) throw new Error(r.reason || tRepo('error'));
          return r.files;
        },
      });
    }
    for (const repo of projectRepos) {
      list.push({
        id: `repo:${repo.id}`,
        label: `${repo.owner}/${repo.repo}`,
        load: async () => (await reposApi.contents(repo.id)).files ?? [],
      });
    }
    return list;
  }, [linkedTaskId, projectRepos, tRepo]);

  const openRepoPicker = useCallback(() => setRepoPickerOpen(true), []);
  const closeRepoPicker = useCallback(() => setRepoPickerOpen(false), []);
  // Presence of this callback IS the entitlement — ChatInput shows "Add context"
  // only when a repo-backed source is in scope.
  const onAddContext = contextSources.length > 0 ? openRepoPicker : undefined;
  const attachRepoFile = useCallback(async (path: string, content: string) => {
    await attach(new File([content], path, { type: 'text/plain' }));
    setRepoPickerOpen(false);
  }, [attach]);

  return { contextSources, onAddContext, repoPickerOpen, closeRepoPicker, attachRepoFile };
}
