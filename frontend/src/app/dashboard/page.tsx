'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Project, Tenant } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { getMe } from '@/lib/auth';
import { ChatInput } from '@/components/ChatInput';
import PageContainer from '@/components/PageContainer';
import { ProjectsContent } from '@/components/ProjectsContent';
import { TabCountBadge } from '@/components/TabCountBadge';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { AiUsageCard } from '@/components/AiUsageCard';
import { OnboardingStepper } from '@/components/OnboardingStepper';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { PulseSubmitCard } from '@/components/insights/PulseWidget';
import { buildInsightDelta } from '@/components/dashboard/metricFormat';
import { cumulativeDailySeries, dailyCounts } from '@/components/dashboard/seriesFromTimestamps';
import { IdeProjectsContent } from '@/components/ide/IdeProjectsContent';
import { DashboardIdeasTab } from '@/components/dashboard/DashboardIdeasTab';
import { DashboardQualityTab } from '@/components/dashboard/DashboardQualityTab';
import { DashboardKnowledgeTab } from '@/components/dashboard/DashboardKnowledgeTab';
import { WorkforcePresenceStripView } from '@/components/workforce/WorkforcePresenceStrip';
import { useWorkforcePresence } from '@/lib/useWorkforcePresence';
import { agentHosts, tasksApi, approvalsApi, type AgentHost } from '@/lib/builderforceApi';

const ONBOARDING_DISMISSED_KEY = 'bf_onboarding_dismissed';

const DASHBOARD_TABS = ['projects', 'workforce', 'ide', 'ideas', 'quality', 'knowledge'] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

/**
 * Dashboard (home) — BuilderForceAgentsLink-style: "What should we build?" chat input,
 * projects preview (View all → /projects), and Workforce section with agent list.
 */
export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard');
  const { isAuthenticated, hasTenant, webToken, tenantToken, tenant, selectTenant } = useAuth();
  const { currentProjectId } = useProjectScope();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [approvalDates, setApprovalDates] = useState<string[]>([]);
  const [taskStats, setTaskStats] = useState<{ total: number; inProgress: number; done: number } | null>(null);
  const [taskDates, setTaskDates] = useState<string[]>([]);

  // Active tab is driven by ?tab= so it deep-links and survives reload (matches
  // the /projects convention). Unknown/absent → the default Projects tab.
  const tabParam = searchParams.get('tab');
  const activeTab: DashboardTab = (DASHBOARD_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as DashboardTab)
    : 'projects';
  const selectTab = useCallback(
    (key: DashboardTab) => {
      router.replace(key === 'projects' ? '/dashboard' : `/dashboard?tab=${key}`, { scroll: false });
    },
    [router],
  );

  // Onboarding stepper state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // Auth guard — allow staying on dashboard if not yet onboarded (no tenant yet)
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/dashboard');
    }
    // No redirect to /tenants here — the onboarding stepper handles workspace creation
  }, [isAuthenticated, router]);

  // Check onboarding status once we have a web token.
  // Only owners go through onboarding — invited members skip it entirely.
  useEffect(() => {
    if (!isAuthenticated || !webToken || onboardingChecked) return;

    // If the user has a workspace selected and they're not an owner in it, skip onboarding.
    if (hasTenant && tenant?.role && tenant.role !== 'owner') {
      setOnboardingChecked(true);
      return;
    }

    const dismissed = typeof window !== 'undefined' && localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
    if (dismissed) {
      setOnboardingChecked(true);
      return;
    }
    getMe(webToken)
      .then(({ onboardingCompletedAt }) => {
        if (!onboardingCompletedAt) {
          setShowOnboarding(true);
        }
      })
      .catch(() => {
        // If the check fails, don't block the user — just skip onboarding
      })
      .finally(() => setOnboardingChecked(true));
  }, [isAuthenticated, webToken, onboardingChecked, hasTenant, tenant]);

  const handleOnboardingWorkspaceCreated = useCallback(
    async (newTenant: Tenant) => {
      await selectTenant(newTenant);
    },
    [selectTenant]
  );

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  const handleOnboardingDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    }
    setShowOnboarding(false);
  }, []);

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

  // The dashboard prompt opens Brain Storm and auto-executes there: Brain creates
  // a chat on demand and streams a reply, then the user can promote it to a
  // project / IDE. (Direct dispatch to an agent host stays on /tasks + /workforce.)
  const handlePromptSubmit = () => {
    const p = prompt.trim();
    if (!p) return;
    setPrompt('');
    router.push(`/brainstorm?prompt=${encodeURIComponent(p)}`);
  };

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

  // If we don't have a tenant AND we're still checking or showing onboarding, render the stepper overlay only
  if (!hasTenant && (showOnboarding || !onboardingChecked)) {
    return showOnboarding ? (
      <OnboardingStepper
        webToken={webToken!}
        tenantToken={tenantToken}
        tenant={tenant}
        existingProjectsCount={projects.length}
        onWorkspaceCreated={handleOnboardingWorkspaceCreated}
        onComplete={handleOnboardingComplete}
        onDismiss={handleOnboardingDismiss}
      />
    ) : null;
  }

  // If no tenant and onboarding was dismissed/complete, send to tenant picker
  if (!hasTenant) {
    router.replace('/tenants?next=/dashboard');
    return null;
  }

  return (
    <PageContainer style={{ padding: 0 }}>
      {showOnboarding && webToken && (
        <OnboardingStepper
          webToken={webToken}
          tenantToken={tenantToken}
          tenant={tenant}
          existingProjectsCount={projects.length}
          onWorkspaceCreated={handleOnboardingWorkspaceCreated}
          onComplete={handleOnboardingComplete}
          onDismiss={handleOnboardingDismiss}
        />
      )}
      <main style={{ padding: '24px 16px' }}>
        {/* Prompt — What should we build? */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
            {t('heading')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
            {t.rich('subheading', {
              brainstorm: (chunks) => <Link href="/brainstorm" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>{chunks}</Link>,
              tasks: (chunks) => <Link href="/projects?tab=tasks" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>{chunks}</Link>,
              workforce: (chunks) => <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>{chunks}</Link>,
            })}
          </p>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <ChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={handlePromptSubmit}
              placeholder={t('promptPlaceholder')}
              submitLabel={t('brainStorm')}
              rows={1}
              submitOnEnter={false}
              showBrainIcon={true}
              showVoice={true}
              secondaryContent={
                connectedAgentHosts.length > 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('agentsConnected', { count: connectedAgentHosts.length })} · {connectedAgentHosts.map((c) => c.name).join(', ')}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('noAgents')}{' '}
                    <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
                      {t('setUpInWorkforce')}
                    </Link>
                  </span>
                )
              }
            />
          </div>
          {pendingApprovalsCount > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warning-text)' }}>
              {t('pendingRequests', { count: pendingApprovalsCount })} ·{' '}
              <Link href="/workforce?tab=approvals" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
                {t('reviewNow')}
              </Link>
            </div>
          )}
        </div>

        {/* Stats strip — five compact tiles in one row (incl. AI usage), each with
            a 14-day trend sparkline + delta chip (InsightStat). 2 columns on
            mobile, 3 from the small breakpoint, all 5 from large up. minWidth:0
            lets the tiles shrink to the narrow columns without overflowing. */}
        {!loading && (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
            style={{ marginBottom: 32 }}
          >
            <InsightStat
              label={t('metric.projects')}
              value={String(scopedProjects.length)}
              sub={t('metric.projectsActive', { count: scopedProjects.filter((p) => (p as { status?: string }).status === 'active').length })}
              series={projectSeries}
              delta={buildInsightDelta(projectSeries, true)}
              href="/projects"
              color="var(--coral-bright, #f4726e)"
              style={{ minWidth: 0 }}
            />
            <InsightStat
              label={t('metric.tasks')}
              value={taskStats ? String(taskStats.total) : '—'}
              sub={taskStats ? t('metric.tasksInProgress', { count: taskStats.inProgress }) : ''}
              series={taskSeries}
              delta={buildInsightDelta(taskSeries, null)}
              href="/projects?tab=tasks"
              color="var(--cyan-bright, #00e5cc)"
              style={{ minWidth: 0 }}
            />
            <InsightStat
              label={t('metric.workforceOnline')}
              value={String(presence.onlineCount)}
              sub={t('metric.workingNow', { count: presence.workingCount })}
              series={presence.activitySeries}
              delta={buildInsightDelta(presence.activitySeries, null)}
              href="/workforce"
              color={presence.onlineCount > 0 ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)'}
              style={{ minWidth: 0 }}
            />
            <InsightStat
              label={t('metric.pendingRequests')}
              value={String(pendingApprovalsCount)}
              sub={pendingApprovalsCount > 0 ? t('metric.requiresReview') : t('metric.allClear')}
              series={approvalSeries}
              delta={buildInsightDelta(approvalSeries, false)}
              href="/workforce?tab=approvals"
              color={pendingApprovalsCount > 0 ? 'rgba(245,158,11,0.9)' : 'var(--text-muted)'}
              style={{ minWidth: 0 }}
            />
            {/* AI usage (month-to-date) — self-gating peer tile; renders null until
                there's trend data, so the row simply shows 4 tiles until then. */}
            <AiUsageCard style={{ minWidth: 0 }} />
          </div>
        )}

        {/* Team pulse (EMP-15) — a member-facing single-tap sentiment card that
            self-hides when there is no open survey (or once the user has answered). */}
        <div style={{ marginBottom: 24 }}>
          <PulseSubmitCard />
        </div>

        {/* Tabs — at-a-glance across the whole workspace. Counts are shown only
            where the dashboard actually knows the total; the shared tab
            components (Workforce, IDE, Ideas, Quality, Knowledge) own their own
            data, so a count badge there would be a misleading partial number. */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 24,
            overflowX: 'auto',
          }}
        >
          {([
            { key: 'projects', label: t('tabs.projects'), count: scopedProjects.length as number | undefined },
            { key: 'workforce', label: t('tabs.workforce'), count: undefined },
            { key: 'ide', label: t('tabs.ide'), count: undefined },
            { key: 'ideas', label: t('tabs.ideas'), count: undefined },
            { key: 'quality', label: t('tabs.quality'), count: undefined },
            { key: 'knowledge', label: t('tabs.knowledge'), count: undefined },
          ] as const).map(({ key, label, count }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectTab(key)}
                style={{
                  padding: '10px 16px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
                <TabCountBadge count={loading ? null : count} />
              </button>
            );
          })}
        </div>

        {/* Projects tab (preview) — reuses ProjectsContent so the cards, table,
            button group, and data shape match the /projects page exactly. */}
        {activeTab === 'projects' && (
          <section style={{ marginBottom: 40 }}>
            <ProjectsContent limit={6} viewAllHref="/projects" />
          </section>
        )}

        {/* Talent / Workforce tab — live "who's online" presence strip on top of
            the shared /workforce roster (cloud agents AND remote hosts). */}
        {activeTab === 'workforce' && (
          <>
            <WorkforcePresenceStripView presence={presence} />
            <WorkforceAgents tenantId={tenantId} />
          </>
        )}

        {/* IDE tab — reuses IdeProjectCard via the shared IdeProjectsContent. */}
        {activeTab === 'ide' && (
          <section style={{ marginBottom: 40 }}>
            <IdeProjectsContent limit={6} viewAllHref="/ide/dashboard" />
          </section>
        )}

        {/* Ideas / Brainstorm tab — the tenant's Brain chats, deep-linked. */}
        {activeTab === 'ideas' && (
          <section style={{ marginBottom: 40 }}>
            <DashboardIdeasTab limit={9} />
          </section>
        )}

        {/* Quality tab — registered collectors + slide-out create. */}
        {activeTab === 'quality' && (
          <section style={{ marginBottom: 40 }}>
            <DashboardQualityTab />
          </section>
        )}

        {/* Knowledge tab — the tenant's SOP/process/doc base. */}
        {activeTab === 'knowledge' && (
          <section style={{ marginBottom: 40 }}>
            <DashboardKnowledgeTab limit={8} />
          </section>
        )}
      </main>
    </PageContainer>
  );
}
