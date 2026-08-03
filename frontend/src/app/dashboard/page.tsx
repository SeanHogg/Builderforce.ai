'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { useOnboardingPrompt } from '@/lib/onboarding';
import { ChatInput } from '@/components/ChatInput';
import { ProjectsContent } from '@/components/ProjectsContent';
import { TabCountBadge } from '@/components/TabCountBadge';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { AiUsageCard } from '@/components/AiUsageCard';
import { OnboardingStepper } from '@/components/OnboardingStepper';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { PulseSubmitCard } from '@/components/insights/PulseWidget';
import { buildInsightDelta } from '@/components/dashboard/metricFormat';
import { cumulativeDailySeries, dailyCounts } from '@/components/dashboard/seriesFromTimestamps';
import { DashboardCreationSessions } from '@/components/dashboard/DashboardCreationSessions';
import { DashboardQualityTab } from '@/components/dashboard/DashboardQualityTab';
import { DashboardKnowledgeTab } from '@/components/dashboard/DashboardKnowledgeTab';
import { WorkforcePresenceStripView } from '@/components/workforce/WorkforcePresenceStrip';
import { useWorkforcePresence } from '@/lib/useWorkforcePresence';
import { agentHosts, tasksApi, approvalsApi, creationSessionsApi, type AgentHost } from '@/lib/builderforceApi';
import { WorkspaceCanvas, type WorkspaceCanvasPanel } from '@/components/workspace-canvas/WorkspaceCanvas';
import styles from './DashboardCanvas.module.css';

const DASHBOARD_TABS = ['create', 'projects', 'workforce', 'quality', 'knowledge'] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

/**
 * Dashboard (home) — BuilderForceAgentsLink-style: "What should we build?" chat input,
 * projects preview (View all → /projects), and Workforce section with agent list.
 */
export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard');
  const { isAuthenticated, hasTenant, webToken, tenantToken, tenant } = useAuth();
  const { currentProjectId } = useProjectScope();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [building, setBuilding] = useState(false);
  const [creationQuota, setCreationQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [approvalDates, setApprovalDates] = useState<string[]>([]);
  const [taskStats, setTaskStats] = useState<{ total: number; inProgress: number; done: number } | null>(null);
  const [taskDates, setTaskDates] = useState<string[]>([]);

  // Create is the default home. Projects remain an optional organizational lens.
  const tabParam = searchParams.get('tab');
  const activeTab: DashboardTab = (DASHBOARD_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as DashboardTab)
    : 'create';
  const selectTab = useCallback(
    (key: DashboardTab) => {
      router.replace(key === 'create' ? '/dashboard' : `/dashboard?tab=${key}`, { scroll: false });
    },
    [router],
  );

  // Onboarding wizard — the show/dismiss decision is shared with the hired
  // dashboard (useOnboardingPrompt); the stepper picks its own account-type track.
  const {
    show: showOnboarding,
    progress: onboardingProgress,
    complete: handleOnboardingComplete,
    dismiss: handleOnboardingDismiss,
  } = useOnboardingPrompt();

  // Auth guard. A brand-new builder's named workspace is auto-provisioned by the
  // onboarding gate before this page renders, so reaching here without a tenant means
  // the picker is the right destination (multi-workspace, or provisioning fell back).
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/dashboard');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    setLoading(true);
    Promise.all([
      fetchProjects().catch(() => [] as Project[]),
      agentHosts.list().catch(() => [] as AgentHost[]),
      approvalsApi.list({ status: 'pending' }).catch(() => []),
    ])
      .then(([projs, agentHostsData, approvalsData]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setAgentHostList(Array.isArray(agentHostsData) ? agentHostsData : []);
        setPendingApprovalsCount(Array.isArray(approvalsData) ? approvalsData.length : 0);
        setApprovalDates(Array.isArray(approvalsData) ? approvalsData.map((a) => a.createdAt) : []);
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, hasTenant]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    void creationSessionsApi.quotas().then((result) => setCreationQuota({ usage: result.usage.sessions, limit: result.limits.sessions })).catch(() => undefined);
  }, [hasTenant, isAuthenticated]);

  // Task stats follow the global project scope: when a project is selected the
  // dashboard reflects just that project's tasks (re-fetched on scope change).
  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    let alive = true;
    tasksApi.list(currentProjectId ?? undefined)
      .then((tasksData) => {
        if (!alive || !Array.isArray(tasksData)) return;
        setTaskStats({
          total: tasksData.length,
          inProgress: tasksData.filter((tk) => tk.status === 'in_progress').length,
          done: tasksData.filter((tk) => tk.status === 'done').length,
        });
        setTaskDates(tasksData.map((tk) => tk.createdAt));
      })
      .catch(() => { if (alive) { setTaskStats(null); setTaskDates([]); } });
    return () => { alive = false; };
  }, [isAuthenticated, hasTenant, currentProjectId]);

  // A prompt creates a session, not a project. Project context can be added later.
  const handlePromptSubmit = useCallback(async () => {
    const p = prompt.trim();
    if (!p || building || (creationQuota?.limit !== -1 && creationQuota != null && creationQuota.usage >= creationQuota.limit)) return;
    setBuilding(true);
    try {
      const created = await creationSessionsApi.create({ title: p.slice(0, 80), initialPrompt: p });
      setPrompt('');
      router.push(`/create/${created.session.id}`);
    } catch {
      // Preserve intent locally if server persistence is briefly unavailable.
      const { createLocalCreationSession } = await import('@/lib/creationSessions');
      router.push(`/create/${createLocalCreationSession(p)}`);
    } finally {
      setBuilding(false);
    }
  }, [prompt, building, creationQuota, router]);

  const connectedAgentHosts = agentHostList.filter((c) => c.online);
  // Live "who's online / what's working" across humans AND agents — powers the
  // renamed "Talent / Workforce online" tile and the presence strip below.
  const presence = useWorkforcePresence();
  // Project stats follow the global scope: a selected project narrows the count
  // and the grid (the grid filter lives in ProjectsContent) to just that project.
  const scopedProjects = currentProjectId != null ? projects.filter((p) => p.id === currentProjectId) : projects;

  // Honest 14-day trend sparklines for the metric tiles — every point is a real
  // count derived from the createdAt of rows we already fetched (no fabricated
  // data). Growth metrics use a cumulative curve; "pending requests" uses the
  // per-day inflow since the tile shows the current open count.
  const projectSeries = useMemo(
    () => cumulativeDailySeries(scopedProjects.map((p) => p.createdAt ?? p.created_at)),
    [scopedProjects],
  );
  const taskSeries = useMemo(() => cumulativeDailySeries(taskDates), [taskDates]);
  const approvalSeries = useMemo(() => dailyCounts(approvalDates), [approvalDates]);

  if (!isAuthenticated) return null;

  // No tenant → the picker (a brand-new builder's named workspace is provisioned
  // upstream by the onboarding gate, so this is the multi-workspace / fallback path).
  if (!hasTenant) {
    router.replace('/tenants?next=/dashboard');
    return null;
  }

  const metricPanels: WorkspaceCanvasPanel[] = loading ? [] : [
    { id: 'dashboard-projects', title: t('metric.projects'), icon: '▦', position: { x: 36, y: 300 }, width: 270, height: 190, content: <InsightStat label={t('metric.projects')} value={String(scopedProjects.length)} sub={t('metric.projectsActive', { count: scopedProjects.filter((p) => (p as { status?: string }).status === 'active').length })} series={projectSeries} delta={buildInsightDelta(projectSeries, true)} href="/projects" color="var(--coral-bright, #f4726e)" style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-tasks', title: t('metric.tasks'), icon: '✓', position: { x: 326, y: 300 }, width: 270, height: 190, content: <InsightStat label={t('metric.tasks')} value={taskStats ? String(taskStats.total) : '—'} sub={taskStats ? t('metric.tasksInProgress', { count: taskStats.inProgress }) : ''} series={taskSeries} delta={buildInsightDelta(taskSeries, null)} href="/projects?tab=tasks" color="var(--cyan-bright, #00e5cc)" style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-workforce', title: t('metric.workforceOnline'), icon: '●', position: { x: 616, y: 300 }, width: 270, height: 190, content: <InsightStat label={t('metric.workforceOnline')} value={String(presence.onlineCount)} sub={t('metric.workingNow', { count: presence.workingCount })} series={presence.activitySeries} delta={buildInsightDelta(presence.activitySeries, null)} href="/workforce" color={presence.onlineCount > 0 ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)'} style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-approvals', title: t('metric.pendingRequests'), icon: '!', position: { x: 906, y: 300 }, width: 270, height: 190, content: <InsightStat label={t('metric.pendingRequests')} value={String(pendingApprovalsCount)} sub={pendingApprovalsCount > 0 ? t('metric.requiresReview') : t('metric.allClear')} series={approvalSeries} delta={buildInsightDelta(approvalSeries, false)} href="/workforce?tab=approvals" color={pendingApprovalsCount > 0 ? 'rgba(245,158,11,0.9)' : 'var(--text-muted)'} style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-ai-usage', title: 'AI usage', icon: '↗', position: { x: 1196, y: 300 }, width: 270, height: 190, content: <AiUsageCard style={{ minWidth: 0, border: 0, padding: 4 }} /> },
  ];

  const panels: WorkspaceCanvasPanel[] = [
    {
      id: 'dashboard-prompt', title: t('heading'), subtitle: 'Start a new creation session', icon: '⚡',
      position: { x: 36, y: 36 }, width: 940, height: 230,
      content: <div className={styles.promptWidget}>
        <p>{t.rich('subheading', {
          brainstorm: (chunks) => <Link href="/brainstorm">{chunks}</Link>,
          tasks: (chunks) => <Link href="/projects?tab=tasks">{chunks}</Link>,
          workforce: (chunks) => <Link href="/workforce">{chunks}</Link>,
        })}</p>
        <div data-tour="demo-build"><ChatInput value={prompt} onChange={setPrompt} onSubmit={handlePromptSubmit} disabled={building || (creationQuota?.limit !== -1 && creationQuota != null && creationQuota.usage >= creationQuota.limit)} placeholder={t('promptPlaceholder')} submitLabel={building ? t('building') : t('build')} rows={1} submitOnEnter={false} showBrainIcon showVoice secondaryContent={connectedAgentHosts.length > 0 ? <span>{t('agentsConnected', { count: connectedAgentHosts.length })} · {connectedAgentHosts.map((c) => c.name).join(', ')}</span> : <span>{t('noAgents')} <Link href="/workforce">{t('setUpInWorkforce')}</Link></span>} /></div>
        {creationQuota?.limit !== -1 && creationQuota != null && creationQuota.usage >= creationQuota.limit && <p role="alert" className={styles.warning}>Your saved Session limit is reached. Archive a Session or upgrade before creating another.</p>}
        {pendingApprovalsCount > 0 && <p className={styles.warning}>{t('pendingRequests', { count: pendingApprovalsCount })} · <Link href="/workforce?tab=approvals">{t('reviewNow')}</Link></p>}
      </div>,
    },
    ...metricPanels,
    { id: 'dashboard-pulse', title: 'Team pulse', subtitle: 'Current workforce sentiment', icon: '♡', position: { x: 996, y: 36 }, width: 470, height: 230, content: <PulseSubmitCard /> },
    {
      id: activeTab === 'create' ? 'dashboard-artifacts' : `dashboard-view-${activeTab}`,
      title: activeTab === 'create' ? 'All artifacts' : t(`tabs.${activeTab}`),
      subtitle: activeTab === 'create' ? 'Card or list view of everything you created' : 'Workspace widget',
      icon: activeTab === 'quality' ? '◆' : activeTab === 'knowledge' ? '▤' : '◇',
      position: { x: 36, y: 530 }, width: 1430, height: 720,
      content: <div className={styles.workspaceWidget}>
        <nav aria-label="Dashboard widgets">{([
          { key: 'create', label: 'Create', count: undefined },
          { key: 'projects', label: t('tabs.projects'), count: scopedProjects.length as number | undefined },
          { key: 'workforce', label: t('tabs.workforce'), count: undefined },
          { key: 'quality', label: t('tabs.quality'), count: undefined },
          { key: 'knowledge', label: t('tabs.knowledge'), count: undefined },
        ] as const).map(({ key, label, count }) => <button key={key} type="button" data-active={activeTab === key} onClick={() => selectTab(key)}>{label}<TabCountBadge count={loading ? null : count} /></button>)}</nav>
        <div className={styles.workspaceContent}>
          {activeTab === 'create' && <DashboardCreationSessions />}
          {activeTab === 'projects' && <ProjectsContent limit={6} viewAllHref="/projects" />}
          {activeTab === 'workforce' && <><WorkforcePresenceStripView presence={presence} /><WorkforceAgents tenantId={tenantId} /></>}
          {activeTab === 'quality' && <DashboardQualityTab />}
          {activeTab === 'knowledge' && <DashboardKnowledgeTab limit={8} />}
        </div>
      </div>,
    },
  ];

  return <>
    {showOnboarding && webToken && <OnboardingStepper webToken={webToken} tenantToken={tenantToken} tenant={tenant} initialProgress={onboardingProgress} onComplete={handleOnboardingComplete} onDismiss={handleOnboardingDismiss} />}
    <WorkspaceCanvas panels={panels} />
  </>;
}
