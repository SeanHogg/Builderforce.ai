'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { brain, creationSessionFoldersApi, creationSessionsApi, workflowDefinitions, type BrainChat, type CreationSessionFolder, type CreationSessionSummary, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { fetchProjects, listIdeProjects, listMyAgents } from '@/lib/api';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { creationLibraryItems, type CreationLibraryFacet, type CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import { UNFILED, type FolderSelection } from './CreationFolderBar';

const SESSIONS_PAGE_SIZE = 24;

/** One frozen empty array, so "no page yet" is referentially stable across renders. */
const NO_SESSIONS: ReadonlyArray<CreationSessionSummary & { matchingObjectId?: string | null }> = [];

export type CreationLibraryStatus = 'active' | 'archived';

/**
 * READING the Create library — the fetches, the paging, the filters, and the one
 * mapping that turns six unrelated API shapes into one list.
 *
 * This used to be the top two-thirds of a 300-line panel component that also rendered
 * the grid, owned the selection, and performed every write. Splitting the reads out is
 * what makes the panel a presentational component again, and it is what lets the
 * mapping (`domains/canvas/domain/creationLibrary.ts`) be pure and tested — the dedupe
 * rule that decides whether a workflow appears twice was previously an inline `Set`
 * with no way to assert on it.
 *
 * i18n lands HERE rather than in the domain: a record's secondary line is its own
 * vocabulary ("Website · active · BuilderForce.AI"), and this is the layer that has
 * the catalogs.
 */
export interface CreationLibrarySurface {
  /** Everything the library holds, after the search/status/folder narrowing but
   *  BEFORE the facet filter — the facet bar counts against this. */
  items: CreationLibraryItem[];
  /** What is actually on screen: `items` with the facet filter applied. */
  visible: CreationLibraryItem[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
  query: string;
  setQuery: (query: string) => void;
  status: CreationLibraryStatus;
  setStatus: (status: CreationLibraryStatus) => void;
  facet: CreationLibraryFacet | null;
  setFacet: (facet: CreationLibraryFacet | null) => void;
  folderFilter: FolderSelection;
  setFolderFilter: (selection: FolderSelection) => void;
  toggleFolderFilter: (folderId: string) => void;
  folders: CreationSessionFolder[];
  reloadFolders: () => void;
  /** Every folder name a move can land in — server-side plus any carried by an item
   *  on screen, so the picker is never short a name. */
  folderOptions: string[];
  projects: Project[];
  /** The raw sessions, for the merge picker (which can only target a real session).
   *  Readonly: the hook hands out either its own page state or the shared empty
   *  constant, and a caller that could push into either would be mutating one. */
  sessions: readonly CreationSessionSummary[];
}

export function useCreationLibrary(): CreationLibrarySurface {
  const t = useTranslations('creationCanvas');
  const modalityCopy = useModalityCopy();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CreationLibraryStatus>('active');
  const [facet, setFacet] = useState<CreationLibraryFacet | null>(null);
  const [folderFilter, setFolderFilter] = useState<FolderSelection>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folders, setFolders] = useState<CreationSessionFolder[]>([]);

  /**
   * The page on screen, TAGGED with the request that produced it.
   *
   * `loading` is derived from that tag rather than held as its own flag, which is what
   * keeps the fetching effect free of a synchronous `setState` (a cascading render).
   * It also closes a race the separate flag had: a slow first request settling after a
   * faster second one would clear `loading` while the sessions on screen belonged to
   * neither query.
   */
  const [page, setPage] = useState<{ key: string; sessions: Array<CreationSessionSummary & { matchingObjectId?: string | null }>; hasMore: boolean } | null>(null);
  /** Bumped by `reload` so a write re-fetches even when nothing about the query changed. */
  const [reloadToken, setReloadToken] = useState(0);

  const [builds, setBuilds] = useState<IdeProject[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [chats, setChats] = useState<BrainChat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  const reloadFolders = useCallback(() => {
    void creationSessionFoldersApi.list().then((result) => setFolders(result.folders)).catch(() => undefined);
  }, []);
  useEffect(reloadFolders, [reloadFolders]);

  // A server search matches object CONTENT, so it is used the moment the box holds
  // enough to search with; below that the plain list is the right read.
  const searchTerm = query.trim().length >= 2 ? query.trim() : '';
  /** Everything that decides WHICH first page this is. Same key, same page. */
  const requestKey = `${status}|${searchTerm}|${reloadToken}`;

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let active = true;
    const load = searchTerm
      ? creationSessionsApi.search({ q: searchTerm, status, limit: SESSIONS_PAGE_SIZE })
      : creationSessionsApi.list(status, undefined, { offset: 0, limit: SESSIONS_PAGE_SIZE });
    void load
      .then((result) => { if (active) setPage({ key: requestKey, sessions: result.sessions, hasMore: result.hasMore }); })
      // A failed read must not leave the library reporting "loading" forever — it
      // reports an empty page for this request, which the empty state answers.
      .catch(() => { if (active) setPage({ key: requestKey, sessions: [], hasMore: false }); });
    return () => { active = false; };
  }, [requestKey, searchTerm, status]);

  // Memoized because it feeds the item mapping and the folder options below: a fresh
  // `[]` on every render would re-map every item in the library on every keystroke.
  const sessions = useMemo(() => page?.sessions ?? NO_SESSIONS, [page]);
  const hasMore = page?.hasMore ?? false;
  const loading = page?.key !== requestKey;

  // Appends the NEXT page. `reload` always replaces from offset 0, which is what a
  // changed search or status needs, but would otherwise re-fetch (and re-render)
  // every item already on screen just to reach one more page.
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const offset = sessions.length;
    const load = searchTerm
      ? creationSessionsApi.search({ q: searchTerm, status, limit: SESSIONS_PAGE_SIZE, offset })
      : creationSessionsApi.list(status, undefined, { offset, limit: SESSIONS_PAGE_SIZE });
    void load
      // Appended against the SAME key: a page that arrives after the reader has
      // changed the search belongs to a list that is no longer on screen.
      .then((result) => setPage((prev) => prev && prev.key === requestKey
        ? { key: prev.key, sessions: [...prev.sessions, ...result.sessions], hasMore: result.hasMore }
        : prev))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, sessions.length, searchTerm, status, requestKey]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([listIdeProjects(), workflowDefinitions.list(), brain.listChats({ limit: 100 }), fetchProjects(), listMyAgents()])
      .then(([buildResult, workflowResult, chatResult, projectResult, agentResult]) => {
        if (!active) return;
        setBuilds(buildResult.status === 'fulfilled' ? buildResult.value : []);
        setWorkflows(workflowResult.status === 'fulfilled' ? workflowResult.value : []);
        setChats(chatResult.status === 'fulfilled' ? chatResult.value : []);
        setProjects(projectResult.status === 'fulfilled' ? projectResult.value : []);
        setAgents(agentResult.status === 'fulfilled' ? agentResult.value : []);
      })
      .finally(() => { if (active) setRecordsLoaded(true); });
    return () => { active = false; };
  }, []);

  const items = useMemo(() => creationLibraryItems({
    sessions: folderFilter === null ? sessions : sessions.filter((session) => (session.folderId ?? UNFILED) === folderFilter),
    builds, workflows, chats, projects, agents,
    query,
    // Records carry no archived state and belong to no folder, so an archived
    // reading or a folder filter would otherwise show rows the filter does not
    // describe — the same reason the old layout hid its resource section for both.
    includeRecords: status === 'active' && folderFilter === null,
    describe: {
      build: (build) => {
        const modality = modalityCopy(build.modality);
        return `${modality.label} · ${build.status}${build.containerName ? ` · ${build.containerName}` : ''}`;
      },
      workflow: (workflow) => `${t('workflowRuns', { count: workflow.runCount ?? 0 })}${workflow.projectName ? ` · ${workflow.projectName}` : ''}`,
      chat: (chat) => `${t('brainSession')}${chat.capability ? ` · ${chat.capability}` : ''}`,
      project: (project) => `${t('object.project')} · ${project.status || t('active').toLowerCase()} · ${t('projectTasks', { count: project.taskCount ?? 0 })}`,
      agent: (agent) => `${t('object.agent')} · ${agent.title || agent.status}`,
    },
    icons: {
      build: (build) => modalityCopy(build.modality).icon,
      workflow: '⌘',
      chat: '●',
      project: '▦',
      agent: '✦',
    },
  }), [sessions, builds, workflows, chats, projects, agents, query, status, folderFilter, modalityCopy, t]);

  const visible = useMemo(() => facet ? items.filter((item) => item.facet === facet) : items, [items, facet]);

  const folderOptions = useMemo(() => [...new Set([
    ...folders.map((folder) => folder.name),
    ...sessions.map((session) => session.folderName).filter((name): name is string => !!name),
  ])].sort((a, b) => a.localeCompare(b)), [folders, sessions]);

  const toggleFolderFilter = useCallback((folderId: string) => {
    setFolderFilter((current) => (current === folderId ? null : folderId));
  }, []);

  return {
    items,
    visible,
    loading: loading || !recordsLoaded,
    hasMore,
    loadingMore,
    loadMore,
    reload,
    query,
    setQuery,
    status,
    setStatus,
    facet,
    setFacet,
    folderFilter,
    setFolderFilter,
    toggleFolderFilter,
    folders,
    reloadFolders,
    folderOptions,
    projects,
    sessions,
  };
}
