'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useRequireAuth } from '@/lib/useRequireAuth';
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
import { DashboardCreationLauncher, DashboardCreationSessions } from '@/components/dashboard/DashboardCreationSessions';
import { DashboardIdeasTab } from '@/components/dashboard/DashboardIdeasTab';
import { DashboardQualityTab } from '@/components/dashboard/DashboardQualityTab';
import { DashboardKnowledgeTab } from '@/components/dashboard/DashboardKnowledgeTab';
import { JourneyStrip } from '@/components/dashboard/JourneyStrip';
import { ActRail } from '@/components/dashboard/ActRail';
import { BusinessTab } from '@/components/dashboard/BusinessTab';
import { InterviewsTab } from '@/components/dashboard/InterviewsTab';
import { ResearchTab } from '@/components/dashboard/ResearchTab';
import { ProfileIdentityCard } from '@/components/profile/ProfileIdentityCard';
import { WorkforcePresenceStripView } from '@/components/workforce/WorkforcePresenceStrip';
import { useWorkforcePresence } from '@/lib/useWorkforcePresence';
import { agentHosts, tasksApi, approvalsApi, creationSessionsApi, type AgentHost } from '@/lib/builderforceApi';
import type { WorkspaceCanvasPanel } from '@/components/workspace-canvas/WorkspaceCanvas';
import { WorkspacePanelList } from '@/components/workspace-canvas/WorkspacePanelList';
import { usePublishReferenceChrome, usePublishReferenceSelect, useReferenceRailActive } from '@/lib/referenceChrome';
import styles from './Dashboard.module.css';

// The founder's journey (PRD: "Idea to Real"), not the generic Create/Projects
// set it replaced. `ideas` absorbs the old `create` tab — the Idea-phase tabs
// (business/interviews/research/profile) lead; workforce/quality/knowledge are
// resequenced after them rather than removed, since they stay real destinations
// once a tenant has something to run.
const DASHBOARD_TABS = ['ideas', 'projects', 'business', 'interviews', 'research', 'profile', 'workforce', 'quality', 'knowledge'] as const;
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
  // A guest never fires the effect that flips this — there is no tenant to read
  // — so it must not default to `true` here, or the metric tiles would show a
  // permanent spinner instead of the honest empty state guests otherwise get.
  const [loading, setLoading] = useState(isAuthenticated && hasTenant);
  const [prompt, setPrompt] = useState('');
  const [building, setBuilding] = useState(false);
  const [creationQuota, setCreationQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [approvalDates, setApprovalDates] = useState<string[]>([]);
  const [taskStats, setTaskStats] = useState<{ total: number; inProgress: number; done: number } | null>(null);
  const [taskDates, setTaskDates] = useState<string[]>([]);

  // Ideas is the default home — the Idea phase is where the journey starts.
  const tabParam = searchParams.get('tab');
  const activeTab: DashboardTab = (DASHBOARD_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as DashboardTab)
    : 'ideas';
  const selectTab = useCallback(
    (key: DashboardTab) => {
      router.replace(key === 'ideas' ? '/dashboard' : `/dashboard?tab=${key}`, { scroll: false });
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
  // onboarding gate before this page renders, so the tenant requirement is left to
  // that gate rather than bouncing to the picker from here.
  const allowed = useRequireAuth({ returnTo: '/dashboard', requireTenant: false });

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
      const { createLocalCreationSession } = await import('@/domains/canvas/infrastructure/localCanvasStore');
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

  // The five tabs, once. `tabRows` is the list; the inline bar and the panel's
  // index rail are two renderings of it, so a sixth view is one entry here and
  // appears in both. Declared below `scopedProjects` so the rail carries the same
  // counts the bar does rather than a second, unlabelled copy of the same tabs.
  const tabRows = DASHBOARD_TABS.map((key) => ({
    key,
    label: t(`tabs.${key}`),
    count: key === 'projects' && !loading ? scopedProjects.length : undefined,
  }));

  // Opened from anywhere in the operator shell this route renders inside
  // `ShellPanel`, which without this called it "Panel" — the generic fallback —
  // because the dashboard is not a nav group. It names itself, and hands over its
  // five tabs as the panel's index rail; they are VIEWS, not anchors, so the rail
  // switches rather than scrolls (`usePublishReferenceSelect`).
  usePublishReferenceChrome({
    title: t('title'),
    sections: tabRows.map(({ key, label, count }) => ({
      id: key,
      label: count != null ? `${label} · ${count}` : label,
    })),
    activeId: activeTab,
  });
  usePublishReferenceSelect((key) => selectTab(key as DashboardTab));
  // Opened as a panel, the rail IS the tab bar — so the inline one below would be
  // the same five buttons a second time. Standalone there is no rail, and the
  // inline bar is the only way to change view, so it must stay.
  const railHasTabs = useReferenceRailActive();

  if (!allowed) return null;

  // Signed IN with no tenant → the picker (a brand-new builder's named workspace
  // is provisioned upstream by the onboarding gate, so this is the multi-workspace
  // / fallback path). A signed-OUT visitor is not sent here at all — `/dashboard`
  // is guest-capable, and every read on this page already gates on `isAuthenticated
  // && hasTenant`, degrading to the sample workspace's honest empty state per the
  // guest-fixture registry rather than fetching nothing and crashing.
  if (isAuthenticated && !hasTenant) {
    router.replace('/tenants?next=/dashboard');
    return null;
  }

  const metricPanels: WorkspaceCanvasPanel[] = loading ? [] : [
    { id: 'dashboard-projects', title: t('metric.projects'), icon: '▦', width: 270, content: <InsightStat label={t('metric.projects')} value={String(scopedProjects.length)} sub={t('metric.projectsActive', { count: scopedProjects.filter((p) => (p as { status?: string }).status === 'active').length })} series={projectSeries} delta={buildInsightDelta(projectSeries, true)} href="/projects" color="var(--coral-bright)" style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-tasks', title: t('metric.tasks'), icon: '✓', width: 270, content: <InsightStat label={t('metric.tasks')} value={taskStats ? String(taskStats.total) : '—'} sub={taskStats ? t('metric.tasksInProgress', { count: taskStats.inProgress }) : ''} series={taskSeries} delta={buildInsightDelta(taskSeries, null)} href="/projects?tab=tasks" color="var(--cyan-bright, var(--cyan-bright))" style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-workforce', title: t('metric.workforceOnline'), icon: '●', width: 270, content: <InsightStat label={t('metric.workforceOnline')} value={String(presence.onlineCount)} sub={t('metric.workingNow', { count: presence.workingCount })} series={presence.activitySeries} delta={buildInsightDelta(presence.activitySeries, null)} href="/workforce" color={presence.onlineCount > 0 ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)'} style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-approvals', title: t('metric.pendingRequests'), icon: '!', width: 270, content: <InsightStat label={t('metric.pendingRequests')} value={String(pendingApprovalsCount)} sub={pendingApprovalsCount > 0 ? t('metric.requiresReview') : t('metric.allClear')} series={approvalSeries} delta={buildInsightDelta(approvalSeries, false)} href="/workforce?tab=approvals" color={pendingApprovalsCount > 0 ? 'rgba(245,158,11,0.9)' : 'var(--text-muted)'} style={{ minWidth: 0, border: 0, padding: 4 }} /> },
    { id: 'dashboard-ai-usage', title: t('panel.aiUsage'), icon: '↗', width: 270, content: <AiUsageCard style={{ minWidth: 0, border: 0, padding: 4 }} /> },
  ];

  const panels: WorkspaceCanvasPanel[] = [
    {
      id: 'dashboard-prompt', title: t('heading'), subtitle: t('panel.promptSubtitle'), icon: '⚡',
      content: <div className={styles.promptWidget}>
        <p>{t.rich('subheading', {
          brainstorm: (chunks) => <Link href="/brainstorm">{chunks}</Link>,
          tasks: (chunks) => <Link href="/projects?tab=tasks">{chunks}</Link>,
          workforce: (chunks) => <Link href="/workforce">{chunks}</Link>,
        })}</p>
        <div data-tour="demo-build"><ChatInput value={prompt} onChange={setPrompt} onSubmit={handlePromptSubmit} disabled={building || (creationQuota?.limit !== -1 && creationQuota != null && creationQuota.usage >= creationQuota.limit)} placeholder={t('promptPlaceholder')} submitLabel={building ? t('building') : t('build')} rows={1} submitOnEnter={false} showBrainIcon showVoice secondaryContent={connectedAgentHosts.length > 0 ? <span>{t('agentsConnected', { count: connectedAgentHosts.length })} · {connectedAgentHosts.map((c) => c.name).join(', ')}</span> : <span>{t('noAgents')} <Link href="/workforce">{t('setUpInWorkforce')}</Link></span>} /></div>
        {creationQuota?.limit !== -1 && creationQuota != null && creationQuota.usage >= creationQuota.limit && <p role="alert" className={styles.warning}>{t('sessionLimitReached')}</p>}
        {pendingApprovalsCount > 0 && <p className={styles.warning}>{t('pendingRequests', { count: pendingApprovalsCount })} · <Link href="/workforce?tab=approvals">{t('reviewNow')}</Link></p>}
      </div>,
    },
    ...metricPanels,
    { id: 'dashboard-pulse', title: t('panel.pulse'), subtitle: t('panel.pulseSubtitle'), icon: '♡', content: <PulseSubmitCard /> },
    ...(activeTab === 'ideas' ? [{
      id: 'dashboard-create', title: t('panel.create'), subtitle: t('panel.createSubtitle'), icon: '✦',
      content: <DashboardCreationLauncher />,
    } satisfies WorkspaceCanvasPanel] : []),
    {
      id: activeTab === 'ideas' ? 'dashboard-artifacts' : `dashboard-view-${activeTab}`,
      title: activeTab === 'ideas' ? t('panel.creations') : t(`tabs.${activeTab}`),
      subtitle: activeTab === 'ideas' ? t('panel.creationsSubtitle') : t('panel.workspaceWidget'),
      icon: activeTab === 'quality' ? '◆' : activeTab === 'knowledge' ? '▤' : '◇',
      content: <div className={styles.workspaceWidget}>
        {!railHasTabs && (
          <nav aria-label={t('widgetsLabel')}>{tabRows.map(({ key, label, count }) => (
            <button key={key} type="button" data-active={activeTab === key} onClick={() => selectTab(key)}>
              {label}<TabCountBadge count={loading ? null : count ?? undefined} />
            </button>
          ))}</nav>
        )}
        <div className={styles.workspaceContent}>
          {activeTab === 'ideas' && <>
            <ActRail />
            <DashboardIdeasTab limit={6} />
            <DashboardCreationSessions />
          </>}
          {activeTab === 'projects' && <ProjectsContent limit={6} viewAllHref="/projects" />}
          {activeTab === 'business' && <BusinessTab />}
          {activeTab === 'interviews' && <InterviewsTab />}
          {activeTab === 'research' && <ResearchTab />}
          {activeTab === 'profile' && <ProfileIdentityCard />}
          {activeTab === 'workforce' && <><WorkforcePresenceStripView presence={presence} /><WorkforceAgents tenantId={tenantId} /></>}
          {activeTab === 'quality' && <DashboardQualityTab />}
          {activeTab === 'knowledge' && <DashboardKnowledgeTab limit={8} />}
        </div>
      </div>,
    },
  ];

  return <>
    {showOnboarding && webToken && <OnboardingStepper webToken={webToken} tenantToken={tenantToken} tenant={tenant} initialProgress={onboardingProgress} onComplete={handleOnboardingComplete} onDismiss={handleOnboardingDismiss} />}
    <JourneyStrip />
    <WorkspacePanelList panels={panels} />
  </>;
}
