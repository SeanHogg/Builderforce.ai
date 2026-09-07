'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brain, creationSessionFoldersApi, creationSessionsApi, workflowDefinitions, type BrainChat, type CreationSessionSummary, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { fetchProjects, listIdeProjects, listMyAgents } from '@/lib/api';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import { getModality } from '@/lib/modality';
import styles from './DashboardCreationSessions.module.css';
import { Icon } from '@/components/ui/Icon';
import { ViewToggle } from '@/components/ViewToggle';
import { CreationSessionTile } from '@/components/creation-sessions/CreationSessionTile';
import { SessionActionBar, type SessionMenuAction } from '@/components/creation-sessions/SessionActionBar';
import { SessionBulkBar } from '@/components/creation-sessions/SessionBulkBar';

/** The canonical toggle's own vocabulary — `table` IS the list view (see
 *  `components/ViewToggle`). Older browsers hold `list` under this key, so the
 *  read below accepts it and normalises rather than silently resetting. */
type CreationLibraryView = 'card' | 'table';
const CREATION_LIBRARY_VIEW_KEY = 'builderforce.dashboard.creationLibraryView';
const SESSIONS_PAGE_SIZE = 24;

/** The bucket a session with no folder falls into — the same key the group
 *  headings and the folder filter both use, so "unfiled" is one idea. */
const UNFILED = '';

export function DashboardCreationSessions() {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<Array<CreationSessionSummary & { matchingObjectId?: string | null }>>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionQuota, setSessionQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [builds, setBuilds] = useState<IdeProject[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [chats, setChats] = useState<BrainChat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [libraryView, setLibraryView] = useState<CreationLibraryView>('card');
  const [savedFolders, setSavedFolders] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const savedView = window.localStorage.getItem(CREATION_LIBRARY_VIEW_KEY);
    if (savedView === 'card') setLibraryView('card');
    else if (savedView === 'table' || savedView === 'list') setLibraryView('table');
  }, []);
  const selectLibraryView = (view: CreationLibraryView) => {
    setLibraryView(view);
    window.localStorage.setItem(CREATION_LIBRARY_VIEW_KEY, view);
  };

  const loadFolders = useCallback(() => {
    void creationSessionFoldersApi.list().then((result) => setSavedFolders(result.folders.map((folder) => folder.name))).catch(() => undefined);
  }, []);
  useEffect(loadFolders, [loadFolders]);

  const reload = useCallback(() => {
    setLoading(true);
    const load = query.trim().length >= 2
      ? creationSessionsApi.search({ q: query.trim(), status, limit: SESSIONS_PAGE_SIZE })
      : creationSessionsApi.list(status, undefined, { offset: 0, limit: SESSIONS_PAGE_SIZE });
    void load.then((result) => { setSessions(result.sessions); setHasMore(result.hasMore); }).finally(() => setLoading(false));
  }, [query, status]);
  useEffect(reload, [reload]);

  // Loads the NEXT page onto the end of what is already showing — `reload`
  // above always replaces from offset 0, which is what a changed search or
  // status filter needs, but would otherwise re-fetch (and re-render) every
  // session already on screen just to reach one more page.
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const offset = sessions.length;
    const load = query.trim().length >= 2
      ? creationSessionsApi.search({ q: query.trim(), status, limit: SESSIONS_PAGE_SIZE, offset })
      : creationSessionsApi.list(status, undefined, { offset, limit: SESSIONS_PAGE_SIZE });
    void load.then((result) => { setSessions((prev) => [...prev, ...result.sessions]); setHasMore(result.hasMore); }).finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, sessions.length, query, status]);
  useEffect(() => { void creationSessionsApi.quotas().then((result) => setSessionQuota({ usage: result.usage.sessions, limit: result.limits.sessions })).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listIdeProjects(), workflowDefinitions.list(), brain.listChats({ limit: 100 }), fetchProjects(), listMyAgents()]).then(([buildResult, workflowResult, chatResult, projectResult, agentResult]) => {
      if (!active) return;
      setBuilds(buildResult.status === 'fulfilled' ? buildResult.value : []);
      setWorkflows(workflowResult.status === 'fulfilled' ? workflowResult.value : []);
      setChats(chatResult.status === 'fulfilled' ? chatResult.value : []);
      setProjects(projectResult.status === 'fulfilled' ? projectResult.value : []);
      setAgents(agentResult.status === 'fulfilled' ? agentResult.value : []);
    }).finally(() => { if (active) setResourcesLoading(false); });
    return () => { active = false; };
  }, []);
  const sessionLimitReached = !!sessionQuota && sessionQuota.limit !== -1 && sessionQuota.usage >= sessionQuota.limit;

  const createBlank = async () => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try {
      const result = await creationSessionsApi.create({ title: t('untitledSession') });
      router.push(`/create/${result.session.id}`);
    } finally { setCreating(false); }
  };

  const act = async (action: 'pin' | 'duplicate' | 'share', session: CreationSessionSummary) => {
    if (action === 'share') { trackActivity('creation_session_shared', { sessionId: session.id, metadata: { clientSurface: 'web', intent: 'open_share' } }); router.push(`/create/${session.id}?share=1`); return; }
    if (action === 'pin') await creationSessionsApi.pin(session.id, !session.pinned);
    if (action === 'duplicate') {
      const copy = await creationSessionsApi.duplicate(session.id);
      router.push(`/create/${copy.session.id}`); return;
    }
    reload();
  };

  // The three write paths every surface shares: one session is the same call
  // with a one-item list, so the single-session action bar and the bulk bar
  // cannot drift on what "archive" or "delete" actually does.
  const archiveSessions = useCallback(async (ids: string[]) => {
    const nextStatus = status === 'archived' ? 'active' : 'archived';
    await Promise.all(ids.map((id) => creationSessionsApi.update(id, { status: nextStatus })));
    if (nextStatus === 'archived') ids.forEach((id) => trackActivity('creation_session_archived', { sessionId: id, metadata: { clientSurface: 'web' } }));
    setSelectedIds([]);
    reload();
  }, [reload, status]);
  const deleteSessions = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map((id) => creationSessionsApi.remove(id)));
    setSelectedIds([]);
    reload();
  }, [reload]);
  const mergeSessions = useCallback(async (targetId: string, sourceIds: string[]) => {
    // Sequential: each merge rewrites the target's graph, so they cannot race.
    for (const sourceId of sourceIds) await creationSessionsApi.merge(targetId, sourceId);
    setSelectedIds([]);
    reload();
  }, [reload]);

  const renameSession = async (session: CreationSessionSummary, title: string) => {
    await creationSessionsApi.update(session.id, { title });
    reload();
  };
  const moveSession = async (session: CreationSessionSummary, folderName: string | null) => {
    const folderId = folderName ? (await creationSessionFoldersApi.ensure(folderName)).folder.id : null;
    await creationSessionsApi.update(session.id, { folderId });
    loadFolders();
    reload();
  };

  const kindFilter = searchParams.get('filter');
  const visible = useMemo(() => sessions
    .filter((session) => !kindFilter || session.preview?.kinds?.includes(kindFilter))
    .filter((session) => folderFilter === null || (session.folderName || UNFILED) === folderFilter)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), [sessions, kindFilter, folderFilter]);
  const selected = useMemo(() => visible.filter((session) => selectedIds.includes(session.id)).map((session) => ({ id: session.id, title: session.title, folder: session.folderName })), [visible, selectedIds]);
  /** Every folder a move can land in: the ones that exist server-side plus any
   *  carried by a session on screen, so the picker is never short a name. */
  const folderOptions = useMemo(() => [...new Set([...savedFolders, ...sessions.map((session) => session.folderName).filter((name): name is string => !!name)])].sort((a, b) => a.localeCompare(b)), [savedFolders, sessions]);
  const toggleFolderFilter = (folder: string) => setFolderFilter((current) => (current === folder ? null : folder));
  const toggleSelected = (id: string, checked: boolean) => setSelectedIds((current) => (checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id)));

  const openBuild = async (build: IdeProject) => {
    const result = await creationSessionsApi.openIdeProject(build.id);
    router.push(openedBoardHref(result, { build: '1' }));
  };
  const openWorkflow = async (workflow: WorkflowDefinitionSummary) => {
    const result = await creationSessionsApi.openResource('workflow', workflow.id);
    router.push(openedBoardHref(result));
  };
  const openChat = async (chat: BrainChat) => {
    const result = await creationSessionsApi.openResource('chat', chat.id);
    router.push(openedBoardHref(result));
  };
  const openProject = async (project: Project) => {
    const result = await creationSessionsApi.openProject(project.id);
    router.push(openedBoardHref(result));
  };
  const openAgent = async (agent: PublishedAgent) => {
    const result = await creationSessionsApi.openResource('agent', agent.id);
    router.push(openedBoardHref(result));
  };
  const visibleBuilds = builds.filter((build) => !query.trim() || `${build.name} ${build.modality} ${build.containerName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleWorkflows = workflows.filter((workflow) => !query.trim() || `${workflow.name} ${workflow.description || ''} ${workflow.projectName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleChats = chats.filter((chat) => !query.trim() || `${chat.title} ${chat.capability || ''} ${chat.origin || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleProjects = projects.filter((project) => !query.trim() || `${project.name} ${project.description || ''} ${project.status || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleAgents = agents.filter((agent) => !query.trim() || `${agent.name} ${agent.title || ''} ${agent.bio || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const representedResources = new Set(visible.flatMap((session) => (session.preview?.objects ?? [])
    .filter((object) => object.resourceType && object.resourceId)
    .map((object) => `${object.resourceType}:${object.resourceId}`)));
  // Resources belong to no folder, so a folder filter excludes them rather than
  // leaving a filtered library holding rows the filter does not describe.
  const resourceItems = status === 'archived' || folderFilter !== null ? [] : [
    ...visibleBuilds.filter((build) => !representedResources.has(`ideProject:${build.id}`)).map((build) => { const modality = getModality(build.modality); return { key: `build-${build.id}`, icon: modality.icon, title: build.name, meta: `${modality.label} · ${build.status}${build.containerName ? ` · ${build.containerName}` : ''}`, open: () => openBuild(build) }; }),
    ...visibleWorkflows.filter((workflow) => !representedResources.has(`workflow:${workflow.id}`)).map((workflow) => ({ key: `workflow-${workflow.id}`, icon: '⌘', title: workflow.name, meta: `${t('workflowRuns', { count: workflow.runCount ?? 0 })}${workflow.projectName ? ` · ${workflow.projectName}` : ''}`, open: () => openWorkflow(workflow) })),
    ...visibleChats.filter((chat) => !representedResources.has(`chat:${chat.id}`)).map((chat) => ({ key: `chat-${chat.id}`, icon: '●', title: chat.title, meta: `${t('brainSession')}${chat.capability ? ` · ${chat.capability}` : ''}`, open: () => openChat(chat) })),
    ...visibleProjects.filter((project) => !representedResources.has(`project:${project.id}`)).map((project) => ({ key: `project-${project.id}`, icon: '▦', title: project.name, meta: `${t('object.project')} · ${project.status || t('active').toLowerCase()} · ${t('projectTasks', { count: project.taskCount ?? 0 })}`, open: () => openProject(project) })),
    ...visibleAgents.filter((agent) => !representedResources.has(`agent:${agent.id}`)).map((agent) => ({ key: `agent-${agent.id}`, icon: '✦', title: agent.name, meta: `${t('object.agent')} · ${agent.title || agent.status}`, open: () => openAgent(agent) })),
  ];

  const renderSessionItems = (items: typeof visible) => items.map((session) => (
    <CreationSessionTile
      key={`session-${session.id}`}
      session={session}
      view={libraryView}
      selected={selectedIds.includes(session.id)}
      onSelectedChange={(checked) => toggleSelected(session.id, checked)}
      projectLabel={(id) => projects.find((project) => project.id === id)?.name ?? t('projectBadge', { id })}
      onOpen={() => router.push(`/create/${session.id}${session.matchingObjectId ? `?focus=${session.matchingObjectId}` : ''}`)}
      onFolderSelect={toggleFolderFilter}
      folderActive={folderFilter === (session.folderName || UNFILED)}
    >
      <SessionActionBar
        session={{ id: session.id, title: session.title, folder: session.folderName }}
        folders={folderOptions}
        mergeCandidates={status === 'active' ? sessions.filter((candidate) => candidate.id !== session.id && candidate.status === 'active').map((candidate) => ({ id: candidate.id, title: candidate.title, folder: candidate.folderName })) : []}
        onRename={(title) => renameSession(session, title)}
        onMove={(folder) => moveSession(session, folder)}
        onMerge={status === 'active' ? (sourceId) => mergeSessions(session.id, [sourceId]) : undefined}
        onDelete={() => deleteSessions([session.id])}
        extraActions={([
          { id: 'pin', label: session.pinned ? t('unpinSession') : t('pinSession'), icon: 'pin', run: () => act('pin', session) },
          { id: 'duplicate', label: t('duplicateSession'), icon: 'copy', run: () => act('duplicate', session) },
          { id: 'share', label: t('shareSession'), icon: 'link', run: () => act('share', session) },
          { id: status === 'archived' ? 'restore' : 'archive', label: status === 'archived' ? t('restoreSession') : t('archiveSession'), icon: 'archive', run: () => archiveSessions([session.id]) },
        ] satisfies SessionMenuAction[])}
      />
    </CreationSessionTile>
  ));

  const folderGroups = folderFilter !== null ? [folderFilter] : [...new Set(visible.map((session) => session.folderName || UNFILED))];

  return <section className={styles.sessionsRoot}>
    <div className={styles.libraryHeader}>
      <div className={styles.libraryIntro}><h2>{t('dashboardTitle')}</h2><p>{t('dashboardSubtitle')}</p></div>
      <div className={styles.libraryControls}>
        {/* The canonical control (`components/ViewToggle`), not a fourth inline
            copy of the same button pair — it owns the glyphs, the order and the
            pressed state, so this library reads exactly like Projects and Tasks. */}
        <ViewToggle<CreationLibraryView> value={libraryView} onChange={selectLibraryView} />
        <select aria-label={t('creationStatusLabel')} value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'archived')} className={styles.librarySelect}><option value="active">{t('active')}</option><option value="archived">{t('archived')}</option></select>
        <input aria-label={t('searchCreationsLabel')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchSessions')} className={styles.librarySearch} />
        <button onClick={createBlank} disabled={creating || sessionLimitReached} title={sessionLimitReached ? t('sessionLimitHint') : undefined} className="btn btn-primary">{creating ? t('creatingSession') : sessionLimitReached ? t('sessionLimitShort') : `+ ${t('newSession')}`}</button>
      </div>
    </div>
    {sessionLimitReached && <p role="alert" className={styles.quotaNotice}>{t('sessionLimitPlan', { limit: sessionQuota?.limit ?? 0 })}</p>}
    {folderFilter !== null && (
      <button type="button" className={styles.folderFilterChip} onClick={() => setFolderFilter(null)}>
        <Icon name="folder" size={14} /> {folderFilter || t('unfiledFolder')}
        <span className={styles.folderFilterClear}>{t('clearFolderFilter')}</span>
        <Icon name="close" size={14} />
      </button>
    )}
    <SessionBulkBar
      selected={selected}
      archived={status === 'archived'}
      onMerge={mergeSessions}
      onArchive={archiveSessions}
      onDelete={deleteSessions}
      onClear={() => setSelectedIds([])}
    />
    {loading || resourcesLoading ? <div className={styles.libraryState}>{t('loadingCreations')}</div> : visible.length === 0 && resourceItems.length === 0 ?
      <button onClick={createBlank} className={styles.emptyLibrary}><strong>{t('blankCanvas')}</strong>{t('blankCanvasHint')}</button> :
      <div aria-label={t('libraryLabel')} data-view={libraryView} className={styles.libraryGrid}>
        {folderGroups.map((folder) => <section key={folder || '__unfiled'} className={styles.folderGroup}>
          {folder && <h3 className={styles.folderHeading}>
            <button type="button" aria-pressed={folderFilter === folder} onClick={() => toggleFolderFilter(folder)} className={styles.folderHeadingButton}>
              <Icon name="folder" size={16} /> {folder}
              <span className={styles.folderHint}>{folderFilter === folder ? t('clearFolderFilter') : t('filterByFolder')}</span>
            </button>
          </h3>}
          {renderSessionItems(visible.filter((session) => (session.folderName || UNFILED) === folder))}
        </section>)}
        {resourceItems.map((item) => <button key={item.key} type="button" onClick={() => void item.open()} className={styles.resourceItem}>
          <span aria-hidden className={styles.resourceIcon}><Icon source={item.icon} size={22} /></span>
          <span className={styles.resourceCopy}><strong>{item.title}</strong><span>{item.meta}</span></span>
          <span aria-hidden className={styles.resourceChevron}><Icon name="chevron-right" size={16} /></span>
        </button>)}
      </div>}
    {!loading && !resourcesLoading && hasMore && (
      <div className={styles.loadMore}>
        <button onClick={loadMore} disabled={loadingMore} className="btn btn-secondary">{loadingMore ? t('loadingMore') : t('loadMoreSessions')}</button>
      </div>
    )}
  </section>;
}
