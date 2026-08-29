'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brain, creationSessionFoldersApi, creationSessionsApi, workflowDefinitions, type BrainChat, type CreationSessionSummary, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { fetchProjects, listIdeProjects, listMyAgents } from '@/lib/api';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { getModality } from '@/lib/modality';
import styles from './DashboardCreationSessions.module.css';
import { Icon } from '@/components/ui/Icon';
import { ViewToggle } from '@/components/ViewToggle';
import { SessionManagementControls, type SessionMenuAction } from '@/components/creation-sessions/SessionManagementControls';
import { useFormat } from "@/i18n/useFormat";

/**
 * A session tile is coloured by the KIND of object it holds, and the board's
 * minimap colours the same objects the same way — so this is the board's identity
 * list, not a second one. It is read from the tokens rather than restated: this
 * copy had already drifted (`website` was the brand blue here and its own hue
 * there), which is what a duplicated palette does.
 */
const KIND_COLOR: Record<string, string> = {
  workflow: 'var(--canvas-obj-workflow)', website: 'var(--canvas-obj-website)',
  chat: 'var(--canvas-obj-chat)', dashboard: 'var(--canvas-obj-dashboard)',
  project: 'var(--canvas-obj-staff)', agent: 'var(--canvas-obj-agent)',
  dataset: 'var(--canvas-obj-dataset)', mockup: 'var(--canvas-obj-mockup)',
};

const CANVAS_STARTERS = [
  { id: 'campaign-studio', icon: '◎', labelKey: 'starterCampaign', descriptionKey: 'starterCampaignDescription' },
  { id: 'product-discovery', icon: '◇', labelKey: 'starterProductDiscovery', descriptionKey: 'starterProductDiscoveryDescription' },
] as const;

/** The canonical toggle's own vocabulary — `table` IS the list view (see
 *  `components/ViewToggle`). Older browsers hold `list` under this key, so the
 *  read below accepts it and normalises rather than silently resetting. */
type CreationLibraryView = 'card' | 'table';
const CREATION_LIBRARY_VIEW_KEY = 'builderforce.dashboard.creationLibraryView';

function modalityStarterPrompt(id: string, label: string, tagline: string): string {
  if (id === 'evermind') return 'Create an Evermind dataset, tokenizer, tuning, evaluation, and telemetry pipeline on this Canvas.';
  return `Create a ${label} in this Canvas. ${tagline}`;
}

export function DashboardCreationLauncher() {
  const t = useTranslations('creationCanvas');
  const modalities = useLocalizedModalities();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [sessionQuota, setSessionQuota] = useState<{ usage: number; limit: number } | null>(null);

  useEffect(() => { void creationSessionsApi.quotas().then((result) => setSessionQuota({ usage: result.usage.sessions, limit: result.limits.sessions })).catch(() => undefined); }, []);
  const sessionLimitReached = !!sessionQuota && sessionQuota.limit !== -1 && sessionQuota.usage >= sessionQuota.limit;

  const createBlank = async () => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try {
      const result = await creationSessionsApi.create({ title: t('untitledSession') });
      router.push(`/create/${result.session.id}`);
    } finally { setCreating(false); }
  };

  const startTemplate = async (name: string, initialPrompt: string) => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try { const result = await creationSessionsApi.create({ title: name, initialPrompt }); router.push(`/create/${result.session.id}`); }
    finally { setCreating(false); }
  };

  return <section className={styles.launcher} aria-labelledby="creation-launcher-title">
    <div className={styles.launcherHeader}>
      <span className={styles.eyebrow}>{t('launcherEyebrow')}</span>
      <h2 id="creation-launcher-title">{t('createTypeTitle')}</h2>
      <p>{t('createTypeSubtitle')}</p>
    </div>

    <div className={styles.creationPaths}>
      <section className={`${styles.creationPath} ${styles.typePath}`} aria-labelledby="create-by-type-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>1</span>
          <div><h3 id="create-by-type-title">{t('createByTypeTitle')}</h3><p>{t('createByTypeSubtitle')}</p></div>
        </div>
        <div className={styles.typeGrid} aria-label={t('createByTypeTitle')}>
          {modalities.map((modality) => <button key={modality.id} type="button" disabled={creating || sessionLimitReached || !!modality.comingSoon} onClick={() => void startTemplate(modality.label, modalityStarterPrompt(modality.id, modality.label, modality.tagline))} className={styles.typeCard}>
            <span className={styles.typeIcon} aria-hidden><Icon source={modality.icon} size={20} /></span>
            <span className={styles.cardCopy}><strong>{modality.label}</strong><span>{modality.tagline}</span></span>
            <span className={styles.cardAction} aria-hidden>{modality.comingSoon ? t('comingSoon') : t('createAction')} <b>→</b></span>
          </button>)}
        </div>
      </section>

      <section className={`${styles.creationPath} ${styles.templatePath}`} aria-labelledby="create-from-template-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>2</span>
          <div><h3 id="create-from-template-title">{t('guidedTemplateTitle')}</h3><p>{t('guidedTemplateSubtitle')}</p></div>
        </div>
        <div className={styles.templateGrid} aria-label={t('guidedTemplatesLabel')}>
          {CANVAS_STARTERS.map((starter) => { const label = t(starter.labelKey); const description = t(starter.descriptionKey); return <button key={starter.id} type="button" disabled={creating || sessionLimitReached} onClick={() => void startTemplate(label, description)} className={styles.templateCard}>
            <span className={styles.templateIcon} aria-hidden><Icon source={starter.icon} size={20} /></span>
            <span className={styles.cardCopy}><strong>{label}</strong><span>{description}</span></span>
            <span className={styles.templateAction}>{t('useTemplate')} <b aria-hidden>→</b></span>
          </button>; })}
        </div>
        <button type="button" onClick={createBlank} disabled={creating || sessionLimitReached} className={styles.blankButton}>
          <span><b aria-hidden><Icon source="＋" size="1em" /></b> {t('blankCanvas')}</span><span aria-hidden>→</span>
        </button>
      </section>
    </div>
    {sessionLimitReached && <p role="alert" className={styles.quotaWarning}>{t('sessionLimitReached')}</p>}
  </section>;
}

export function DashboardCreationSessions() {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<Array<CreationSessionSummary & { matchingObjectId?: string | null }>>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sessionQuota, setSessionQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [builds, setBuilds] = useState<IdeProject[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [chats, setChats] = useState<BrainChat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [libraryView, setLibraryView] = useState<CreationLibraryView>('card');

  useEffect(() => {
    const savedView = window.localStorage.getItem(CREATION_LIBRARY_VIEW_KEY);
    if (savedView === 'card') setLibraryView('card');
    else if (savedView === 'table' || savedView === 'list') setLibraryView('table');
  }, []);
  const selectLibraryView = (view: CreationLibraryView) => {
    setLibraryView(view);
    window.localStorage.setItem(CREATION_LIBRARY_VIEW_KEY, view);
  };

  const reload = useCallback(() => {
    setLoading(true);
    const load = query.trim().length >= 2 ? creationSessionsApi.search({ q: query.trim(), status }) : creationSessionsApi.list(status);
    void load.then((result) => setSessions(result.sessions)).finally(() => setLoading(false));
  }, [query, status]);
  useEffect(reload, [reload]);
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

  const act = async (action: 'pin' | 'duplicate' | 'archive' | 'restore' | 'share', session: CreationSessionSummary) => {
    if (action === 'share') { trackActivity('creation_session_shared', { sessionId: session.id, metadata: { clientSurface: 'web', intent: 'open_share' } }); router.push(`/create/${session.id}?share=1`); return; }
    if (action === 'pin') await creationSessionsApi.pin(session.id, !session.pinned);
    if (action === 'duplicate') {
      const copy = await creationSessionsApi.duplicate(session.id);
      router.push(`/create/${copy.session.id}`); return;
    }
    if (action === 'archive') { await creationSessionsApi.update(session.id, { status: 'archived' }); trackActivity('creation_session_archived', { sessionId: session.id, metadata: { clientSurface: 'web' } }); }
    if (action === 'restore') await creationSessionsApi.update(session.id, { status: 'active' });
    reload();
  };

  const renameSession = async (session: CreationSessionSummary, title: string) => {
    await creationSessionsApi.update(session.id, { title });
    reload();
  };
  const moveSession = async (session: CreationSessionSummary, folderName: string | null) => {
    const folderId = folderName ? (await creationSessionFoldersApi.ensure(folderName)).folder.id : null;
    await creationSessionsApi.update(session.id, { folderId });
    reload();
  };
  const mergeSession = async (session: CreationSessionSummary, sourceId: string) => {
    await creationSessionsApi.merge(session.id, sourceId);
    reload();
  };
  const deleteSession = async (session: CreationSessionSummary) => {
    await creationSessionsApi.remove(session.id);
    reload();
  };

  const visible = [...sessions].filter((session) => !searchParams.get('filter') || session.preview?.kinds?.includes(searchParams.get('filter')!)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const openBuild = async (build: IdeProject) => {
    const result = await creationSessionsApi.openIdeProject(build.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}&build=1`);
  };
  const openWorkflow = async (workflow: WorkflowDefinitionSummary) => {
    const result = await creationSessionsApi.openResource('workflow', workflow.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}`);
  };
  const openChat = async (chat: BrainChat) => {
    const result = await creationSessionsApi.openResource('chat', chat.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}`);
  };
  const openProject = async (project: Project) => {
    const result = await creationSessionsApi.openProject(project.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}`);
  };
  const openAgent = async (agent: PublishedAgent) => {
    const result = await creationSessionsApi.openResource('agent', agent.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}`);
  };
  const visibleBuilds = builds.filter((build) => !query.trim() || `${build.name} ${build.modality} ${build.containerName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleWorkflows = workflows.filter((workflow) => !query.trim() || `${workflow.name} ${workflow.description || ''} ${workflow.projectName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleChats = chats.filter((chat) => !query.trim() || `${chat.title} ${chat.capability || ''} ${chat.origin || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleProjects = projects.filter((project) => !query.trim() || `${project.name} ${project.description || ''} ${project.status || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleAgents = agents.filter((agent) => !query.trim() || `${agent.name} ${agent.title || ''} ${agent.bio || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const representedResources = new Set(visible.flatMap((session) => (session.preview?.objects ?? [])
    .filter((object) => object.resourceType && object.resourceId)
    .map((object) => `${object.resourceType}:${object.resourceId}`)));
  const resourceItems = status === 'archived' ? [] : [
    ...visibleBuilds.filter((build) => !representedResources.has(`ideProject:${build.id}`)).map((build) => { const modality = getModality(build.modality); return { key: `build-${build.id}`, icon: modality.icon, title: build.name, meta: `${modality.label} · ${build.status}${build.containerName ? ` · ${build.containerName}` : ''}`, open: () => openBuild(build) }; }),
    ...visibleWorkflows.filter((workflow) => !representedResources.has(`workflow:${workflow.id}`)).map((workflow) => ({ key: `workflow-${workflow.id}`, icon: '⌘', title: workflow.name, meta: `${t('workflowRuns', { count: workflow.runCount ?? 0 })}${workflow.projectName ? ` · ${workflow.projectName}` : ''}`, open: () => openWorkflow(workflow) })),
    ...visibleChats.filter((chat) => !representedResources.has(`chat:${chat.id}`)).map((chat) => ({ key: `chat-${chat.id}`, icon: '●', title: chat.title, meta: `${t('brainSession')}${chat.capability ? ` · ${chat.capability}` : ''}`, open: () => openChat(chat) })),
    ...visibleProjects.filter((project) => !representedResources.has(`project:${project.id}`)).map((project) => ({ key: `project-${project.id}`, icon: '▦', title: project.name, meta: `${t('object.project')} · ${project.status || t('active').toLowerCase()} · ${t('projectTasks', { count: project.taskCount ?? 0 })}`, open: () => openProject(project) })),
    ...visibleAgents.filter((agent) => !representedResources.has(`agent:${agent.id}`)).map((agent) => ({ key: `agent-${agent.id}`, icon: '✦', title: agent.name, meta: `${t('object.agent')} · ${agent.title || agent.status}`, open: () => openAgent(agent) })),
  ];
  const renderSessionItems = (items: typeof visible) => items.map((session) => { const target = `/create/${session.id}${session.matchingObjectId ? `?focus=${session.matchingObjectId}` : ''}`; const running = (session.preview?.objects ?? []).filter((object) => ['agent','task','workflow'].includes(object.kind) && ['running','in progress','in_progress','queued','assigned'].includes(String(object.status || '').toLowerCase())).length; return <article key={`session-${session.id}`} onClick={() => router.push(target)} onKeyDown={(event) => { if (event.key === 'Enter') router.push(target); }} tabIndex={0} style={{ display: libraryView === 'table' ? 'grid' : 'block', gridTemplateColumns: libraryView === 'table' ? '108px minmax(0, 1fr)' : undefined, alignItems: 'stretch', color: 'inherit', border: `1px solid ${session.unread ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: libraryView === 'table' ? 'var(--radius-lg)' : 'var(--radius-xl)', overflow: 'hidden', background: 'var(--surface-raised)', boxShadow: '0 4px 16px rgba(20,35,60,.05)', cursor: 'pointer' }}>
      <div style={{ height: libraryView === 'table' ? '100%' : 150, minHeight: libraryView === 'table' ? 82 : undefined, position: 'relative', overflow: 'hidden', borderRight: libraryView === 'table' ? '1px solid var(--border-subtle)' : undefined, background: 'radial-gradient(circle, rgba(116,137,165,.2) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {(session.preview?.objects ?? []).slice(0, 8).map((object, index) => <span key={object.id} title={object.title} style={{ position: 'absolute', left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`, top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`, width: 42, height: 26, borderRadius: 'var(--radius-sm)', border: `2px solid ${KIND_COLOR[object.kind] ?? 'var(--canvas-obj-unknown)'}`, background: 'var(--surface-raised)', transform: 'translate(-50%, -50%)', boxShadow: '0 3px 9px var(--shadow-color)' }} />)}
        {!session.preview?.objects?.length && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{t('blankCanvasEmpty')}</span>}
      </div>
      <div style={{ padding: libraryView === 'table' ? '11px 14px' : 14 }}><strong style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.pinned && <Icon name="sparkles" size={14} />} {session.title}{session.unread ? ` · ${t('unreadBadge')}` : ''}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{(session.preview?.kinds ?? []).slice(0, 5).map((kind) => <small key={kind} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '2px 6px' }}>{kind}</small>)}{(session.projectIds ?? []).map((id) => <small key={id} style={{ borderRadius: 'var(--radius-lg)', padding: '2px 6px', background: 'var(--surface-sunken)' }}>{projects.find((project) => project.id === id)?.name ?? t('projectBadge', { id })}</small>)}</div>
        <span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, color: 'var(--text-secondary)', fontSize: 12 }}><span>{t('sessionObjectsPeople', { objects: session.preview?.objectCount ?? 0, people: session.collaboratorCount ?? 1 })}{running ? ` · ${t('sessionRunning', { count: running })}` : ''}</span><span>{fmt.date(session.lastActivityAt)}</span></span>
        {session.folderName && <small style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: 7, color: 'var(--text-muted)' }}><Icon name="folder" size={13} /> {session.folderName}</small>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <SessionManagementControls
            session={{ id: session.id, title: session.title, folder: session.folderName }}
            mergeCandidates={status === 'active' ? sessions.filter((candidate) => candidate.id !== session.id && candidate.status === 'active').map((candidate) => ({ id: candidate.id, title: candidate.title, folder: candidate.folderName })) : []}
            onRename={(title) => renameSession(session, title)}
            onMove={(folder) => moveSession(session, folder)}
            onMerge={status === 'active' ? (sourceId) => mergeSession(session, sourceId) : undefined}
            onDelete={() => deleteSession(session)}
            extraActions={([
              { id: 'pin', label: session.pinned ? t('unpinSession') : t('pinSession'), icon: 'pin', run: () => act('pin', session) },
              { id: 'duplicate', label: t('duplicateSession'), icon: 'copy', run: () => act('duplicate', session) },
              { id: 'share', label: t('shareSession'), icon: 'link', run: () => act('share', session) },
              { id: status === 'archived' ? 'restore' : 'archive', label: status === 'archived' ? t('restoreSession') : t('archiveSession'), icon: 'archive', run: () => act(status === 'archived' ? 'restore' : 'archive', session) },
            ] satisfies SessionMenuAction[])}
          />
        </div>
      </div>
    </article>; });

  return <section style={{ marginBottom: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
      <div><h2 style={{ margin: 0, fontSize: 20 }}>{t('dashboardTitle')}</h2><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{t('dashboardSubtitle')}</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* The canonical control (`components/ViewToggle`), not a fourth inline
            copy of the same button pair — it owns the glyphs, the order and the
            pressed state, so this library reads exactly like Projects and Tasks. */}
        <ViewToggle<CreationLibraryView> value={libraryView} onChange={selectLibraryView} />
        <select aria-label={t('creationStatusLabel')} value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'archived')} style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '9px' }}><option value="active">{t('active')}</option><option value="archived">{t('archived')}</option></select>
        <input aria-label={t('searchCreationsLabel')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchSessions')} style={{ width: 310, maxWidth: '42vw', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '9px 11px', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
        <button onClick={createBlank} disabled={creating || sessionLimitReached} title={sessionLimitReached ? t('sessionLimitHint') : undefined} className="btn btn-primary">{creating ? t('creatingSession') : sessionLimitReached ? t('sessionLimitShort') : `+ ${t('newSession')}`}</button>
      </div>
    </div>
    {sessionLimitReached && <p role="alert" style={{ margin: '-7px 0 14px', color: 'var(--warning)', fontSize: 12 }}>{t('sessionLimitPlan', { limit: sessionQuota?.limit ?? 0 })}</p>}
    {loading || resourcesLoading ? <div style={{ padding: 36, color: 'var(--text-secondary)' }}>{t('loadingCreations')}</div> : visible.length === 0 && resourceItems.length === 0 ?
      <button onClick={createBlank} style={{ width: '100%', minHeight: 220, border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-xl)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', cursor: 'pointer' }}><strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 18, marginBottom: 6 }}>{t('blankCanvas')}</strong>{t('blankCanvasHint')}</button> :
      <div aria-label={t('libraryLabel')} data-view={libraryView} style={{ display: 'grid', gridTemplateColumns: libraryView === 'card' ? 'repeat(auto-fill, minmax(260px, 1fr))' : '1fr', gap: libraryView === 'card' ? 16 : 8 }}>
        {[...new Set(visible.map((session) => session.folderName || ''))].map((folder) => <section key={folder || '__unfiled'} style={{ display: 'contents' }}>
          {folder && <h3 className="ui-text-card-title" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '8px 0 0', color: 'var(--text-secondary)' }}><Icon name="folder" size={16} /> {folder}</h3>}
          {renderSessionItems(visible.filter((session) => (session.folderName || '') === folder))}
        </section>)}
        {resourceItems.map((item) => <button key={item.key} type="button" onClick={() => void item.open()} style={{ minHeight: libraryView === 'card' ? 132 : 70, display: 'grid', gridTemplateColumns: libraryView === 'table' ? '42px minmax(0, 1fr) auto' : '1fr', alignItems: 'center', gap: libraryView === 'table' ? 12 : 0, padding: libraryView === 'table' ? '12px 16px' : 15, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <span aria-hidden style={{ display: 'grid', placeItems: 'center', width: libraryView === 'table' ? 36 : 'auto', height: libraryView === 'table' ? 36 : 'auto', borderRadius: 'var(--radius-md)', background: libraryView === 'table' ? 'var(--surface-sunken)' : 'transparent' }}><Icon source={item.icon} size={22} /></span>
          <span style={{ minWidth: 0 }}><strong style={{ display: 'block', marginTop: libraryView === 'card' ? 8 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</strong><span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.meta}</span></span>
          {libraryView === 'table' && <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</span>}
        </button>)}
      </div>}
  </section>;
}
