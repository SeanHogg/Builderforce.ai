'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { OnboardingStepper } from '@/components/OnboardingStepper';
import { agentHosts, tasksApi, approvalsApi, type AgentHost } from '@/lib/builderforceApi';

const ONBOARDING_DISMISSED_KEY = 'bf_onboarding_dismissed';

/**
 * Dashboard (home) — BuilderForceAgentsLink-style: "What should we build?" chat input,
 * projects preview (View all → /projects), and Workforce section with agent list.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant, webToken, tenantToken, tenant, selectTenant } = useAuth();
  const { currentProjectId } = useProjectScope();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'projects' | 'workforce'>('projects');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [taskStats, setTaskStats] = useState<{ total: number; inProgress: number; done: number } | null>(null);

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
          inProgress: tasksData.filter((t) => t.status === 'in_progress').length,
          done: tasksData.filter((t) => t.status === 'done').length,
        });
      })
      .catch(() => { if (alive) setTaskStats(null); });
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
  // Project stats follow the global scope: a selected project narrows the count
  // and the grid (the grid filter lives in ProjectsContent) to just that project.
  const scopedProjects = currentProjectId != null ? projects.filter((p) => p.id === currentProjectId) : projects;

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
            What should we build?
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
            Start in <Link href="/brainstorm" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Brain Storm</Link> to ideate, then execute as a project and build in the IDE—or assign work via <Link href="/projects?tab=tasks" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Tasks</Link> and <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>Workforce</Link> agents.
          </p>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <ChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={handlePromptSubmit}
              placeholder="Build a budget tracker with Material UI components…"
              submitLabel="Brain Storm"
              rows={1}
              submitOnEnter={false}
              showBrainIcon={true}
              showVoice={true}
              secondaryContent={
                connectedAgentHosts.length > 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {connectedAgentHosts.length} agent{connectedAgentHosts.length !== 1 ? 's' : ''} connected · {connectedAgentHosts.map((c) => c.name).join(', ')}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    No agents connected —{' '}
                    <Link href="/workforce" style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
                      set up in Workforce
                    </Link>
                  </span>
                )
              }
            />
          </div>
          {pendingApprovalsCount > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warning-text)' }}>
              {pendingApprovalsCount} pending request{pendingApprovalsCount !== 1 ? 's' : ''} ·{' '}
              <Link href="/workforce?tab=approvals" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
                review now
              </Link>
            </div>
          )}
        </div>

        {/* Stats strip — 2 columns on mobile (4 are unreadably cramped on a
            phone), 4 from the small breakpoint up. */}
        {!loading && (
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            style={{ marginBottom: 32 }}
          >
            {[
              {
                label: 'Projects',
                value: scopedProjects.length,
                sub: `${scopedProjects.filter((p) => (p as { status?: string }).status === 'active').length} active`,
                href: '/projects',
                color: 'var(--coral-bright, #f4726e)',
              },
              {
                label: 'Tasks',
                value: taskStats?.total ?? '—',
                sub: taskStats ? `${taskStats.inProgress} in progress` : '',
                href: '/projects?tab=tasks',
                color: 'var(--cyan-bright, #00e5cc)',
              },
              {
                label: 'Agents online',
                value: connectedAgentHosts.length,
                sub: `${agentHostList.length} registered`,
                href: '/workforce',
                color: connectedAgentHosts.length > 0 ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
              },
              {
                label: 'Pending requests',
                value: pendingApprovalsCount,
                sub: pendingApprovalsCount > 0 ? 'requires review' : 'all clear',
                href: '/workforce?tab=approvals',
                color: pendingApprovalsCount > 0 ? 'rgba(245,158,11,0.9)' : 'var(--text-muted)',
              },
            ].map(({ label, value, sub, href, color }) => (
              <Link
                key={label}
                href={href}
                style={{
                  background: 'var(--bg-base, #0a0f1a)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }}>
                  {value}
                </div>
                {sub && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Tabs — Projects / Workforce */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 24,
          }}
        >
          {([
            { key: 'projects', label: 'Projects', count: scopedProjects.length },
            // Workforce content is the shared <WorkforceAgents> component, which
            // owns its own data (cloud agents + remote hosts). The dashboard
            // doesn't fetch that combined total, so no count badge here rather
            // than a misleading hosts-only number.
            { key: 'workforce', label: 'Workforce', count: undefined },
          ] as const).map(({ key, label, count }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
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
                }}
              >
                {label}
                <TabCountBadge count={loading ? null : count} />
              </button>
            );
          })}
        </div>

        {/* Projects tab (preview) — reuses ProjectsContent so the cards, table,
            button group, and data shape match the /projects page exactly. The
            "Projects" tab above is the heading, and its count badge is the
            project count, so the preview hides both (preview mode). */}
        {activeTab === 'projects' && (
          <section style={{ marginBottom: 40 }}>
            <ProjectsContent limit={6} viewAllHref="/projects" />
          </section>
        )}

        {/* Workforce tab — reuses the same component as /workforce so the
            dashboard shows cloud agents AND remote hosts, not just hosts. */}
        {activeTab === 'workforce' && <WorkforceAgents tenantId={tenantId} />}
      </main>
    </PageContainer>
  );
}
