'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project, Tenant } from '@/lib/types';
import { fetchProjects, deleteProject } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { getMe } from '@/lib/auth';
import { ChatInput } from '@/components/ChatInput';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectDetailsPanel } from '@/components/ProjectDetailsPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import MascotIcon from '@/components/MascotIcon';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { OnboardingStepper } from '@/components/OnboardingStepper';
import { ViewToggle } from '@/components/ViewToggle';
import { agentHosts, tasksApi, approvalsApi, type AgentHost, type Task } from '@/lib/builderforceApi';

const ONBOARDING_DISMISSED_KEY = 'bf_onboarding_dismissed';

/**
 * Dashboard (home) — BuilderForceAgentsLink-style: "What should we build?" chat input,
 * projects preview (View all → /projects), and Workforce section with agent list.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant, webToken, tenantToken, tenant, selectTenant } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [detailsProject, setDetailsProject] = useState<Project | null>(null);
  const [selectedAgentHost, setSelectedAgentHost] = useState<AgentHost | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [activeTab, setActiveTab] = useState<'projects' | 'workforce'>('projects');
  const [confirmProject, setConfirmProject] = useState<Project | null>(null);
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
      tasksApi.list().catch(() => [] as Task[]),
    ])
      .then(([projs, agentHostsData, approvalsData, tasksData]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setAgentHostList(Array.isArray(agentHostsData) ? agentHostsData : []);
        setPendingApprovalsCount(Array.isArray(approvalsData) ? approvalsData.length : 0);
        if (Array.isArray(tasksData)) {
          setTaskStats({
            total: tasksData.length,
            inProgress: tasksData.filter((t) => t.status === 'in_progress').length,
            done: tasksData.filter((t) => t.status === 'done').length,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, hasTenant]);

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

  const projectPreview = projects.slice(0, 6);

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
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
              {pendingApprovalsCount} pending approval{pendingApprovalsCount !== 1 ? 's' : ''} ·{' '}
              <Link href="/approvals" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
                review now
              </Link>
            </div>
          )}
        </div>

        {/* Stats strip */}
        {!loading && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 32,
            }}
          >
            {[
              {
                label: 'Projects',
                value: projects.length,
                sub: `${projects.filter((p) => (p as { status?: string }).status === 'active').length} active`,
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
                label: 'Pending approvals',
                value: pendingApprovalsCount,
                sub: pendingApprovalsCount > 0 ? 'requires review' : 'all clear',
                href: '/approvals',
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
            { key: 'projects', label: 'Projects', count: projects.length },
            { key: 'workforce', label: 'Workforce', count: agentHostList.length },
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
                {!loading && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Projects tab (preview) */}
        {activeTab === 'projects' && (
        <section style={{ marginBottom: 40 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Projects</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ViewToggle value={viewMode} onChange={setViewMode} />
              <Link
                href="/projects"
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  padding: '6px 12px',
                  borderRadius: 8,
                }}
              >
                View all
              </Link>
              <Link
                href="/projects?create=1"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                  boxShadow: '0 4px 14px var(--shadow-coral-mid)',
                }}
              >
                + New project
              </Link>
            </div>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No projects yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Create your first project to start organizing work
              </div>
              <Link
                href="/projects?create=1"
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  borderRadius: 10,
                  fontWeight: 600,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                }}
              >
                Create project
              </Link>
            </div>
          ) : viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projectPreview.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onCardClick={setDetailsProject}
                  onDetailsClick={setDetailsProject}
                  showDetailsButton
                  onAssignedAgentClick={(ac) => {
                    const agentHost = agentHostList.find((c) => c.id === ac.id);
                    if (agentHost) setSelectedAgentHost(agentHost);
                  }}
                  onDelete={async (proj) => {
                    try {
                      await deleteProject(proj.id);
                      setProjects((prev) => prev.filter((x) => x.id !== proj.id));
                      setDetailsProject((d) => (d && d.id === proj.id ? null : d));
                    } catch (err) {
                      console.error(err);
                      alert('Failed to delete project');
                    }
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Name</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Description</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Agent</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projectPreview.map((project) => (
                    <tr key={project.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text-primary)' }}>{project.name}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.description ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {project.assignedAgentHost ? (
                          <button
                            type="button"
                            onClick={() => {
                              const agentHost = agentHostList.find((c) => c.id === project.assignedAgentHost!.id);
                              if (agentHost) setSelectedAgentHost(agentHost);
                            }}
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: 'var(--coral-bright)',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              textDecoration: 'underline',
                            }}
                          >
                            {project.assignedAgentHost.name}
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setDetailsProject(project)}
                            aria-label="Details"
                            style={{
                              padding: 6,
                              fontSize: 0,
                              background: 'var(--bg-base)',
                              color: 'var(--coral-bright)',
                              border: '1px solid var(--coral-bright)',
                              borderRadius: 8,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 32,
                              height: 32,
                            }}
                          >
                            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                              <path d="M9 2h6l6 6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4z" />
                              <circle cx="15" cy="15" r="3" />
                              <line x1="17.5" y1="17.5" x2="21" y2="21" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => (window.location.href = `/ide/${project.publicId ?? project.id}`)}
                            aria-label="Open in IDE"
                            style={{
                              padding: 6,
                              fontSize: 0,
                              background: 'var(--bg-base)',
                              color: 'var(--coral-bright)',
                              border: '1px solid var(--coral-bright)',
                              borderRadius: 8,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 32,
                              height: 32,
                            }}
                          >
                            <span style={{ fontSize: 18 }} aria-hidden>💻</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmProject(project)}
                            style={{
                              padding: '6px 10px',
                              fontSize: 12,
                              fontWeight: 600,
                              color: 'var(--coral-bright)',
                              background: 'transparent',
                              border: '1px solid var(--coral-bright)',
                              borderRadius: 8,
                              cursor: 'pointer',
                            }}
                          >
                            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                              <path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        )}

        {detailsProject && (
          <ProjectDetailsPanel
            project={detailsProject}
            open={!!detailsProject}
            onClose={() => setDetailsProject(null)}
            onProjectUpdate={(updated) => {
              setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...updated, assignedAgentHost: p.assignedAgentHost } : p)));
              setDetailsProject((p) => (p && p.id === updated.id ? updated : p));
            }}
            onDelete={async (p) => {
              try {
                await deleteProject(p.id);
                setProjects((prev) => prev.filter((x) => x.id !== p.id));
                setDetailsProject(null);
              } catch (err) {
                console.error(err);
                alert('Failed to delete project');
              }
            }}
          />
        )}

        {selectedAgentHost && (
          <AgentHostSlideOutPanel
            agentHost={selectedAgentHost}
            open={!!selectedAgentHost}
            onClose={() => setSelectedAgentHost(null)}
            onDeleted={(id) => setAgentHostList((prev) => prev.filter((h) => h.id !== id))}
          />
        )}
        <ConfirmDialog
          open={!!confirmProject}
          message={
            confirmProject ? `Delete project "${confirmProject.name}"? This cannot be undone.` : ''
          }
          onCancel={() => setConfirmProject(null)}
          onConfirm={async () => {
            if (!confirmProject) return;
            try {
              await deleteProject(confirmProject.id);
              setProjects((prev) => prev.filter((x) => x.id !== confirmProject.id));
              if (detailsProject && detailsProject.id === confirmProject.id) {
                setDetailsProject(null);
              }
            } catch (err) {
              console.error(err);
              alert('Failed to delete project');
            } finally {
              setConfirmProject(null);
            }
          }}
        />

        {/* Workforce tab */}
        {activeTab === 'workforce' && (
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Workforce</h2>
            <Link
              href="/workforce"
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: 8,
              }}
            >
              Manage workforce
            </Link>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading…</div>
          ) : agentHostList.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ marginBottom: 12 }}><MascotIcon size={48} /></div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No agents registered</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Register an agent in Workforce to start delegating work
              </div>
              <Link
                href="/workforce"
                style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  borderRadius: 10,
                  fontWeight: 600,
                  textDecoration: 'none',
                  fontFamily: 'var(--font-display)',
                }}
              >
                Open Workforce
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {agentHostList.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 20,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                        #{c.id}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: c.online ? 'rgba(34, 197, 94, 0.15)' : 'var(--bg-deep)',
                        color: c.online ? '#22c55e' : 'var(--text-muted)',
                      }}
                    >
                      {c.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {c.lastSeenAt ? `Last seen ${new Date(c.lastSeenAt).toLocaleString()}` : 'Never connected'}
                  </div>
                  <Link
                    href="/workforce"
                    style={{
                      display: 'inline-block',
                      marginTop: 10,
                      fontSize: 12,
                      color: 'var(--coral-bright)',
                      textDecoration: 'none',
                    }}
                  >
                    Manage →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
        )}
      </main>
    </div>
  );
}
