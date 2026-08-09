'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brain, creationSessionsApi, workflowDefinitions, type BrainChat, type CreationSessionSummary, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { fetchProjects, listIdeProjects, listMyAgents } from '@/lib/api';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { getModality } from '@/lib/modality';
import styles from './DashboardCreationSessions.module.css';

const KIND_COLOR: Record<string, string> = {
  workflow: '#7357ed', website: '#3978f6', chat: '#e94b9b', dashboard: '#08b59d',
  project: '#f09a3e', agent: '#8a5cf5', dataset: '#12a6c8', mockup: '#ef6d92',
};

const CANVAS_STARTERS = [
  { id: 'campaign-studio', icon: '◎', labelKey: 'starterCampaign', descriptionKey: 'starterCampaignDescription' },
  { id: 'product-discovery', icon: '◇', labelKey: 'starterProductDiscovery', descriptionKey: 'starterProductDiscoveryDescription' },
] as const;

type CreationLibraryView = 'card' | 'list';
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
      const result = await creationSessionsApi.create({ title: 'Untitled session' });
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
      <span className={styles.eyebrow}>Create</span>
      <h2 id="creation-launcher-title">{t('createTypeTitle')}</h2>
      <p>{t('createTypeSubtitle')}</p>
    </div>

    <div className={styles.creationPaths}>
      <section className={styles.creationPath} aria-labelledby="create-by-type-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>1</span>
          <div><h3 id="create-by-type-title">Create by type</h3><p>Choose the kind of thing you want to make.</p></div>
        </div>
        <div className={styles.typeGrid} aria-label="Create by type">
          {modalities.map((modality) => <button key={modality.id} type="button" disabled={creating || sessionLimitReached || !!modality.comingSoon} onClick={() => void startTemplate(modality.label, modalityStarterPrompt(modality.id, modality.label, modality.tagline))} className={styles.typeCard}>
            <span className={styles.typeIcon} aria-hidden>{modality.icon}</span>
            <span className={styles.cardCopy}><strong>{modality.label}</strong><span>{modality.tagline}</span></span>
            <span className={styles.cardAction} aria-hidden>{modality.comingSoon ? 'Coming soon' : 'Create'} <b>→</b></span>
          </button>)}
        </div>
      </section>

      <section className={`${styles.creationPath} ${styles.templatePath}`} aria-labelledby="create-from-template-title">
        <div className={styles.pathHeader}>
          <span className={styles.step}>2</span>
          <div><h3 id="create-from-template-title">Use a guided template</h3><p>Start with a complete, connected workflow.</p></div>
        </div>
        <div className={styles.templateGrid} aria-label="Guided templates">
          {CANVAS_STARTERS.map((starter) => { const label = t(starter.labelKey); const description = t(starter.descriptionKey); return <button key={starter.id} type="button" disabled={creating || sessionLimitReached} onClick={() => void startTemplate(label, description)} className={styles.templateCard}>
            <span className={styles.templateIcon} aria-hidden>{starter.icon}</span>
            <span className={styles.cardCopy}><strong>{label}</strong><span>{description}</span></span>
            <span className={styles.templateAction}>Use template <b aria-hidden>→</b></span>
          </button>; })}
        </div>
        <button type="button" onClick={createBlank} disabled={creating || sessionLimitReached} className={styles.blankButton}>
          <span><b aria-hidden>＋</b> Start with a blank canvas</span><span aria-hidden>→</span>
        </button>
      </section>
    </div>
    {sessionLimitReached && <p role="alert" className={styles.quotaWarning}>Your saved Session limit is reached. Archive a Session or upgrade before creating another.</p>}
  </section>;
}

export function DashboardCreationSessions() {
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
    if (savedView === 'card' || savedView === 'list') setLibraryView(savedView);
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
      const result = await creationSessionsApi.create({ title: 'Untitled session' });
      router.push(`/create/${result.session.id}`);
    } finally { setCreating(false); }
  };

  const act = async (action: 'pin' | 'rename' | 'duplicate' | 'archive' | 'restore' | 'share', session: CreationSessionSummary) => {
    if (action === 'share') { trackActivity('creation_session_shared', { sessionId: session.id, metadata: { clientSurface: 'web', intent: 'open_share' } }); router.push(`/create/${session.id}?share=1`); return; }
    if (action === 'pin') await creationSessionsApi.pin(session.id, !session.pinned);
    if (action === 'rename') {
      const title = window.prompt('Rename session', session.title)?.trim();
      if (!title) return;
      await creationSessionsApi.update(session.id, { title });
    }
    if (action === 'duplicate') {
      const copy = await creationSessionsApi.duplicate(session.id);
      router.push(`/create/${copy.session.id}`); return;
    }
    if (action === 'archive') { await creationSessionsApi.update(session.id, { status: 'archived' }); trackActivity('creation_session_archived', { sessionId: session.id, metadata: { clientSurface: 'web' } }); }
    if (action === 'restore') await creationSessionsApi.update(session.id, { status: 'active' });
    reload();
  };

  const visible = [...sessions].filter((session) => !searchParams.get('filter') || session.preview?.kinds?.includes(searchParams.get('filter')!)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const openBuild = async (build: IdeProject) => {
    const result = await creationSessionsApi.openIdeProject(build.id);
    router.push(`/create/${result.sessionId}?focus=${result.objectId}`);
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
    ...visibleBuilds.filter((build) => !representedResources.has(`project:${build.storageProjectId}`)).map((build) => { const modality = getModality(build.modality); return { key: `build-${build.id}`, icon: modality.icon, title: build.name, meta: `${modality.label} · ${build.status}${build.containerName ? ` · ${build.containerName}` : ''}`, open: () => openBuild(build) }; }),
    ...visibleWorkflows.filter((workflow) => !representedResources.has(`workflow:${workflow.id}`)).map((workflow) => ({ key: `workflow-${workflow.id}`, icon: '⌘', title: workflow.name, meta: `${t('workflowRuns', { count: workflow.runCount ?? 0 })}${workflow.projectName ? ` · ${workflow.projectName}` : ''}`, open: () => openWorkflow(workflow) })),
    ...visibleChats.filter((chat) => !representedResources.has(`chat:${chat.id}`)).map((chat) => ({ key: `chat-${chat.id}`, icon: '●', title: chat.title, meta: `${t('brainSession')}${chat.capability ? ` · ${chat.capability}` : ''}`, open: () => openChat(chat) })),
    ...visibleProjects.filter((project) => !representedResources.has(`project:${project.id}`)).map((project) => ({ key: `project-${project.id}`, icon: '▦', title: project.name, meta: `${t('object.project')} · ${project.status || t('active').toLowerCase()} · ${t('projectTasks', { count: project.taskCount ?? 0 })}`, open: () => openProject(project) })),
    ...visibleAgents.filter((agent) => !representedResources.has(`agent:${agent.id}`)).map((agent) => ({ key: `agent-${agent.id}`, icon: '✦', title: agent.name, meta: `${t('object.agent')} · ${agent.title || agent.status}`, open: () => openAgent(agent) })),
  ];
  const renderSessionItems = (items: typeof visible) => items.map((session) => { const target = `/create/${session.id}${session.matchingObjectId ? `?focus=${session.matchingObjectId}` : ''}`; const running = (session.preview?.objects ?? []).filter((object) => ['agent','task','workflow'].includes(object.kind) && ['running','in progress','in_progress','queued','assigned'].includes(String(object.status || '').toLowerCase())).length; return <article key={`session-${session.id}`} onClick={() => router.push(target)} onKeyDown={(event) => { if (event.key === 'Enter') router.push(target); }} tabIndex={0} style={{ display: libraryView === 'list' ? 'grid' : 'block', gridTemplateColumns: libraryView === 'list' ? '108px minmax(0, 1fr)' : undefined, alignItems: 'stretch', color: 'inherit', border: `1px solid ${session.unread ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: libraryView === 'list' ? 'var(--radius-lg)' : 'var(--radius-xl)', overflow: 'hidden', background: 'var(--surface-raised)', boxShadow: '0 4px 16px rgba(20,35,60,.05)', cursor: 'pointer' }}>
      <div style={{ height: libraryView === 'list' ? '100%' : 150, minHeight: libraryView === 'list' ? 82 : undefined, position: 'relative', overflow: 'hidden', borderRight: libraryView === 'list' ? '1px solid var(--border-subtle)' : undefined, background: 'radial-gradient(circle, rgba(116,137,165,.2) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {(session.preview?.objects ?? []).slice(0, 8).map((object, index) => <span key={object.id} title={object.title} style={{ position: 'absolute', left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`, top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`, width: 42, height: 26, borderRadius: 'var(--radius-sm)', border: `2px solid ${KIND_COLOR[object.kind] ?? '#8291a8'}`, background: 'var(--surface-raised)', transform: 'translate(-50%, -50%)', boxShadow: '0 3px 9px #26364d22' }} />)}
        {!session.preview?.objects?.length && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Blank canvas</span>}
      </div>
      <div style={{ padding: libraryView === 'list' ? '11px 14px' : 14 }}><strong style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.pinned ? '★ ' : ''}{session.title}{session.unread ? ' · New' : ''}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{(session.preview?.kinds ?? []).slice(0, 5).map((kind) => <small key={kind} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '2px 6px' }}>{kind}</small>)}{(session.projectIds ?? []).map((id) => <small key={id} style={{ borderRadius: 'var(--radius-lg)', padding: '2px 6px', background: 'var(--surface-sunken)' }}>Project {id}</small>)}</div>
        <span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, color: 'var(--text-secondary)', fontSize: 12 }}><span>{session.preview?.objectCount ?? 0} objects · {session.collaboratorCount ?? 1} people{running ? ` · ${running} running` : ''}</span><span>{new Date(session.lastActivityAt).toLocaleDateString()}</span></span>
        <div onClick={(event) => event.stopPropagation()} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>{(['pin','rename','duplicate','share', status === 'archived' ? 'restore' : 'archive'] as const).map((action) => <button key={action} type="button" onClick={() => void act(action, session)} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', padding: '4px 7px', cursor: 'pointer', textTransform: 'capitalize' }}>{action === 'pin' && session.pinned ? 'Unpin' : action}</button>)}</div>
      </div>
    </article>; });

  return <section style={{ marginBottom: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
      <div><h2 style={{ margin: 0, fontSize: 20 }}>{t('dashboardTitle')}</h2><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{t('dashboardSubtitle')}</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div role="group" aria-label="Creation library view" style={{ display: 'flex', padding: 3, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
          <button type="button" aria-pressed={libraryView === 'card'} onClick={() => selectLibraryView('card')} title="Card view" style={{ border: 0, borderRadius: 'var(--radius-sm)', padding: '6px 9px', background: libraryView === 'card' ? 'var(--accent)' : 'transparent', color: libraryView === 'card' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}>▦ <span>Card</span></button>
          <button type="button" aria-pressed={libraryView === 'list'} onClick={() => selectLibraryView('list')} title="List view" style={{ border: 0, borderRadius: 'var(--radius-sm)', padding: '6px 9px', background: libraryView === 'list' ? 'var(--accent)' : 'transparent', color: libraryView === 'list' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}>☷ <span>List</span></button>
        </div>
        <select aria-label="Creation status" value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'archived')} style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '9px' }}><option value="active">{t('active')}</option><option value="archived">{t('archived')}</option></select>
        <input aria-label="Search creations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchSessions')} style={{ width: 310, maxWidth: '42vw', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '9px 11px', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
        <button onClick={createBlank} disabled={creating || sessionLimitReached} title={sessionLimitReached ? 'Archive a Session or upgrade before creating another.' : undefined} className="btn btn-primary">{creating ? 'Creating…' : sessionLimitReached ? 'Session limit reached' : `+ ${t('newSession')}`}</button>
      </div>
    </div>
    {sessionLimitReached && <p role="alert" style={{ margin: '-7px 0 14px', color: 'var(--warning, #b45309)', fontSize: 12 }}>Your plan includes {sessionQuota?.limit} Sessions. Archive one or upgrade before starting another saved Session.</p>}
    {loading || resourcesLoading ? <div style={{ padding: 36, color: 'var(--text-secondary)' }}>{t('loadingCreations')}</div> : visible.length === 0 && resourceItems.length === 0 ?
      <button onClick={createBlank} style={{ width: '100%', minHeight: 220, border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-xl)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', cursor: 'pointer' }}><strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 18, marginBottom: 6 }}>Start with a blank canvas</strong>Describe what you want to create above, or click here.</button> :
      <div aria-label="Creation library" data-view={libraryView} style={{ display: 'grid', gridTemplateColumns: libraryView === 'card' ? 'repeat(auto-fill, minmax(260px, 1fr))' : '1fr', gap: libraryView === 'card' ? 16 : 8 }}>
        {renderSessionItems(visible)}
        {resourceItems.map((item) => <button key={item.key} type="button" onClick={() => void item.open()} style={{ minHeight: libraryView === 'card' ? 132 : 70, display: 'grid', gridTemplateColumns: libraryView === 'list' ? '42px minmax(0, 1fr) auto' : '1fr', alignItems: 'center', gap: libraryView === 'list' ? 12 : 0, padding: libraryView === 'list' ? '12px 16px' : 15, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <span aria-hidden style={{ display: 'grid', placeItems: 'center', width: libraryView === 'list' ? 36 : 'auto', height: libraryView === 'list' ? 36 : 'auto', borderRadius: 'var(--radius-md)', background: libraryView === 'list' ? 'var(--surface-sunken)' : 'transparent', fontSize: 22 }}>{item.icon}</span>
          <span style={{ minWidth: 0 }}><strong style={{ display: 'block', marginTop: libraryView === 'card' ? 8 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</strong><span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.meta}</span></span>
          {libraryView === 'list' && <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</span>}
        </button>)}
      </div>}
  </section>;
}
