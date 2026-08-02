'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brain, creationSessionsApi, workflowDefinitions, type BrainChat, type CreationSessionSummary, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { listIdeProjects } from '@/lib/api';
import type { IdeProject } from '@/lib/types';
import { useLocalizedModalities } from '@/lib/useModalityCopy';
import { getModality } from '@/lib/modality';

const KIND_COLOR: Record<string, string> = {
  workflow: '#7357ed', website: '#3978f6', chat: '#e94b9b', dashboard: '#08b59d',
  project: '#f09a3e', agent: '#8a5cf5', dataset: '#12a6c8', mockup: '#ef6d92',
};

export function DashboardCreationSessions() {
  const t = useTranslations('creationCanvas');
  const modalities = useLocalizedModalities();
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
  const [resourcesLoading, setResourcesLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const load = query.trim().length >= 2 ? creationSessionsApi.search({ q: query.trim(), status }) : creationSessionsApi.list(status);
    void load.then((result) => setSessions(result.sessions)).finally(() => setLoading(false));
  }, [query, status]);
  useEffect(reload, [reload]);
  useEffect(() => { void creationSessionsApi.quotas().then((result) => setSessionQuota({ usage: result.usage.sessions, limit: result.limits.sessions })).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listIdeProjects(), workflowDefinitions.list(), brain.listChats({ limit: 100 })]).then(([buildResult, workflowResult, chatResult]) => {
      if (!active) return;
      setBuilds(buildResult.status === 'fulfilled' ? buildResult.value : []);
      setWorkflows(workflowResult.status === 'fulfilled' ? workflowResult.value : []);
      setChats(chatResult.status === 'fulfilled' ? chatResult.value : []);
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
  const isCompleted = (session: CreationSessionSummary) => {
    const objects = session.preview?.objects ?? [];
    return objects.length > 0 && objects.some((object) => ['complete', 'completed', 'done', 'delivered', 'published'].includes(String(object.status || '').toLowerCase()));
  };
  const completed = visible.filter(isCompleted);
  const shared = visible.filter((session) => session.role !== 'owner' && !isCompleted(session));
  const continuing = visible.filter((session) => session.role === 'owner' && !isCompleted(session));
  const startTemplate = async (name: string, initialPrompt: string) => {
    if (creating || sessionLimitReached) return;
    setCreating(true);
    try { const result = await creationSessionsApi.create({ title: name, initialPrompt }); router.push(`/create/${result.session.id}`); }
    finally { setCreating(false); }
  };
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
  const visibleBuilds = builds.filter((build) => !query.trim() || `${build.name} ${build.modality} ${build.containerName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleWorkflows = workflows.filter((workflow) => !query.trim() || `${workflow.name} ${workflow.description || ''} ${workflow.projectName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleChats = chats.filter((chat) => !query.trim() || `${chat.title} ${chat.capability || ''} ${chat.origin || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const renderCards = (items: typeof visible) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
    {items.map((session) => { const target = `/create/${session.id}${session.matchingObjectId ? `?focus=${session.matchingObjectId}` : ''}`; const running = (session.preview?.objects ?? []).filter((object) => ['agent','task','workflow'].includes(object.kind) && ['running','in progress','in_progress','queued','assigned'].includes(String(object.status || '').toLowerCase())).length; return <article key={session.id} onClick={() => router.push(target)} onKeyDown={(event) => { if (event.key === 'Enter') router.push(target); }} tabIndex={0} style={{ color: 'inherit', border: `1px solid ${session.unread ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 16, overflow: 'hidden', background: 'var(--surface-raised)', boxShadow: '0 4px 16px rgba(20,35,60,.05)', cursor: 'pointer' }}>
      <div style={{ height: 150, position: 'relative', overflow: 'hidden', background: 'radial-gradient(circle, rgba(116,137,165,.2) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {(session.preview?.objects ?? []).slice(0, 8).map((object, index) => <span key={object.id} title={object.title} style={{ position: 'absolute', left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`, top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`, width: 42, height: 26, borderRadius: 7, border: `2px solid ${KIND_COLOR[object.kind] ?? '#8291a8'}`, background: 'var(--surface-raised)', transform: 'translate(-50%, -50%)', boxShadow: '0 3px 9px #26364d22' }} />)}
        {!session.preview?.objects?.length && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Blank canvas</span>}
      </div>
      <div style={{ padding: 14 }}><strong style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.pinned ? '★ ' : ''}{session.title}{session.unread ? ' · New' : ''}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{(session.preview?.kinds ?? []).slice(0, 5).map((kind) => <small key={kind} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '2px 6px' }}>{kind}</small>)}{(session.projectIds ?? []).map((id) => <small key={id} style={{ borderRadius: 10, padding: '2px 6px', background: 'var(--surface-subtle)' }}>Project {id}</small>)}</div>
        <span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, color: 'var(--text-secondary)', fontSize: 12 }}><span>{session.preview?.objectCount ?? 0} objects · {session.collaboratorCount ?? 1} people{running ? ` · ${running} running` : ''}</span><span>{new Date(session.lastActivityAt).toLocaleDateString()}</span></span>
        <div onClick={(event) => event.stopPropagation()} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>{(['pin','rename','duplicate','share', status === 'archived' ? 'restore' : 'archive'] as const).map((action) => <button key={action} type="button" onClick={() => void act(action, session)} style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'transparent', color: 'var(--text-secondary)', padding: '4px 7px', cursor: 'pointer', textTransform: 'capitalize' }}>{action === 'pin' && session.pinned ? 'Unpin' : action}</button>)}</div>
      </div>
    </article>; })}
  </div>;

  return <section style={{ marginBottom: 40 }}>
    <section style={{ marginBottom: 34 }}>
      <div style={{ marginBottom: 14 }}><h2 style={{ margin: 0, fontSize: 20 }}>{t('createTypeTitle')}</h2><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{t('createTypeSubtitle')}</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
        {modalities.map((modality) => <button key={modality.id} type="button" disabled={creating || sessionLimitReached || !!modality.comingSoon} onClick={() => void startTemplate(modality.label, `Create a ${modality.label} in this Canvas. ${modality.tagline}`)} style={{ minHeight: 130, padding: 17, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 14, background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: modality.comingSoon ? 'not-allowed' : 'pointer', opacity: modality.comingSoon ? .55 : 1 }}><span style={{ fontSize: 28 }} aria-hidden>{modality.icon}</span><strong style={{ display: 'block', marginTop: 8 }}>{modality.label}</strong><span style={{ display: 'block', marginTop: 5, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>{modality.tagline}</span></button>)}
      </div>
    </section>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
      <div><h2 style={{ margin: 0, fontSize: 20 }}>{t('dashboardTitle')}</h2><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>{t('dashboardSubtitle')}</p></div>
      <div style={{ display: 'flex', gap: 8 }}><select aria-label="Session status" value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'archived')} style={{ border: '1px solid var(--border-default)', borderRadius: 9, background: 'var(--bg-input)', color: 'var(--text-primary)', padding: '9px' }}><option value="active">{t('active')}</option><option value="archived">{t('archived')}</option></select><input aria-label="Search Creation Sessions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchSessions')} style={{ width: 310, maxWidth: '42vw', border: '1px solid var(--border-default)', borderRadius: 9, padding: '9px 11px', background: 'var(--bg-input)', color: 'var(--text-primary)' }} /><button onClick={createBlank} disabled={creating || sessionLimitReached} title={sessionLimitReached ? 'Archive a Session or upgrade before creating another.' : undefined} className="btn btn-primary">{creating ? 'Creating…' : sessionLimitReached ? 'Session limit reached' : `+ ${t('newSession')}`}</button></div>
    </div>
    {sessionLimitReached && <p role="alert" style={{ margin: '-7px 0 14px', color: 'var(--warning, #b45309)', fontSize: 12 }}>Your plan includes {sessionQuota?.limit} Sessions. Archive one or upgrade before starting another saved Session.</p>}
    {loading ? <div style={{ padding: 36, color: 'var(--text-secondary)' }}>Loading sessions…</div> : sessions.length === 0 ?
      <button onClick={createBlank} style={{ width: '100%', minHeight: 220, border: '1px dashed var(--border-default)', borderRadius: 16, background: 'var(--surface-raised)', color: 'var(--text-secondary)', cursor: 'pointer' }}><strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 18, marginBottom: 6 }}>Start with a blank canvas</strong>Describe what you want to create above, or click here.</button> :
      <div style={{ display: 'grid', gap: 28 }}>
        {!!continuing.length && <section><h3 style={{ fontSize: 15, margin: '0 0 10px' }}>{t('continueCreating')}</h3>{renderCards(continuing)}</section>}
        {!!shared.length && <section><h3 style={{ fontSize: 15, margin: '0 0 10px' }}>{t('sharedWithMe')}</h3>{renderCards(shared)}</section>}
        {!!completed.length && <section><h3 style={{ fontSize: 15, margin: '0 0 10px' }}>{t('recentlyCompleted')}</h3>{renderCards(completed)}</section>}
      </div>}
    {status === 'active' && !query.trim() && <section style={{ marginTop: 28 }}><h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Templates</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>{[
      ['Campaign studio', 'Build a campaign workflow, interactive landing page, forecast dashboard, and evaluation frame.'],
      ['Product discovery', 'Synthesize customer feedback into the top requested features, visual mockups, and a delivery roadmap.'],
      ['Evermind model lab', 'Create an Evermind dataset, tokenizer, tuning, evaluation, and telemetry pipeline on this canvas.'],
    ].map(([name, instruction]) => <button key={name} onClick={() => void startTemplate(name, instruction)} disabled={creating || sessionLimitReached} style={{ padding: 16, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}><strong>{name}</strong><span style={{ display: 'block', marginTop: 5, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{instruction}</span></button>)}</div></section>}
    <section style={{ marginTop: 34 }}>
      <div style={{ marginBottom: 12 }}><h3 style={{ fontSize: 16, margin: 0 }}>{t('existingCreations')}</h3><p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>{t('existingCreationsSubtitle')}</p></div>
      {resourcesLoading ? <div style={{ padding: 22, color: 'var(--text-secondary)' }}>{t('loadingCreations')}</div> : !visibleBuilds.length && !visibleWorkflows.length && !visibleChats.length ? <p className="text-muted">{t('noCreations')}</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 12 }}>
        {visibleBuilds.map((build) => { const modality = getModality(build.modality); return <button key={`build-${build.id}`} type="button" onClick={() => void openBuild(build)} style={{ padding: 15, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}><span aria-hidden style={{ fontSize: 22 }}>{modality.icon}</span><strong style={{ display: 'block', marginTop: 6 }}>{build.name}</strong><span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>{modality.label} · {build.status}{build.containerName ? ` · ${build.containerName}` : ''}</span></button>; })}
        {visibleWorkflows.map((workflow) => <button key={`workflow-${workflow.id}`} type="button" onClick={() => void openWorkflow(workflow)} style={{ padding: 15, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}><span aria-hidden style={{ fontSize: 22 }}>⌘</span><strong style={{ display: 'block', marginTop: 6 }}>{workflow.name}</strong><span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>{t('workflowRuns', { count: workflow.runCount ?? 0 })}{workflow.projectName ? ` · ${workflow.projectName}` : ''}</span></button>)}
        {visibleChats.map((chat) => <button key={`chat-${chat.id}`} type="button" onClick={() => void openChat(chat)} style={{ padding: 15, textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-raised)', color: 'var(--text-primary)', cursor: 'pointer' }}><span aria-hidden style={{ fontSize: 22 }}>●</span><strong style={{ display: 'block', marginTop: 6 }}>{chat.title}</strong><span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>{t('brainSession')}{chat.capability ? ` · ${chat.capability}` : ''}</span></button>)}
      </div>}
    </section>
  </section>;
}
