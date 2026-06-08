'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { AgentHost } from '@/lib/builderforceApi';
import { fetchProjects, createProject, deleteProject } from '@/lib/api';
import { agentHosts } from '@/lib/builderforceApi';
import { ProjectDetailsPanel, type ProjectPanelTab } from '@/components/ProjectDetailsPanel';
import { ProjectCard } from '@/components/ProjectCard';
import { ArchitectureAnalysisButton } from '@/components/ArchitectureAnalysisButton';
import { DeleteProjectDialog } from '@/components/DeleteProjectDialog';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ViewToggle } from '@/components/ViewToggle';
import { ScheduleCalendar } from '@/components/ScheduleCalendar';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

type ProjectsView = 'card' | 'table' | 'calendar' | 'gantt';

/** Where the Task board button navigates — the consolidated Projects/Tasks page, Tasks tab. */
const taskBoardHref = (projectId: number) => `/projects?tab=tasks&project=${projectId}`;

/**
 * Projects content — full project list, create-project modal, open project → IDE.
 *
 * Reusable: rendered standalone by the Projects/Tasks page (Projects tab) and any
 * other surface that needs the project list. Auth gating is the parent's job; this
 * component fetches its own data, mirroring {@link TaskMgmtContent}.
 */
export function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsProject, setDetailsProject] = useState<Project | null>(null);
  const [detailsInitialTab, setDetailsInitialTab] = useState<ProjectPanelTab>('details');
  const [viewMode, setViewMode] = useState<ProjectsView>('card');
  const [selectedAgentHost, setSelectedAgentHost] = useState<AgentHost | null>(null);
  const [confirmProject, setConfirmProject] = useState<Project | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  useEffect(() => {
    Promise.all([
      fetchProjects().catch(() => {
        setError('Failed to load projects. Check your connection and try again.');
        return [] as Project[];
      }),
      agentHosts.list().catch(() => [] as AgentHost[]),
    ]).then(([projs, agentHostsData]) => {
      setProjects(projs);
      setAgentHostList(agentHostsData);
    }).finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (searchParams.get('create') === '1') setShowForm(true);
  }, [searchParams]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        template: 'vanilla',
      });
      setProjects((prev) => [project, ...prev]);
      setNewProjectName('');
      setNewProjectDesc('');
      setShowForm(false);
      if (searchParams.get('create') === '1') router.replace('/projects', { scroll: false });
    } catch (err) {
      if (isPlanLimitError(err)) {
        setShowForm(false);
        setPlanError(err);
      } else {
        setError('Failed to create project');
      }
    } finally {
      setIsCreating(false);
    }
  };

  // Open the project Information panel on a given tab. Used by the Details button
  // (default tab) and the Architect button (PRDs to read the result, or
  // Integrations when a repo must be mapped before a run can start).
  const openDetails = (project: Project, tab: ProjectPanelTab = 'details') => {
    setDetailsInitialTab(tab);
    setDetailsProject(project);
  };
  const onArchitectureView = (project: Project) => openDetails(project, 'prds');
  const onArchitectureConfigureRepo = (project: Project) => openDetails(project, 'integrations');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* New Project Modal */}
      {showForm && (
        <div className="modal-overlay" style={{ zIndex: 50 }}>
          <div
            className="rounded-xl p-6 w-full max-w-md border border-gray-700"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              New Project
            </h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Project Name *
                </label>
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Awesome App"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Description
                </label>
                <input
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="Optional description..."
                  style={{
                    width: '100%',
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    outline: 'none',
                  }}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newProjectName.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: isCreating || !newProjectName.trim() ? 'not-allowed' : 'pointer',
                    opacity: isCreating || !newProjectName.trim() ? 0.7 : 1,
                  }}
                >
                  {isCreating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} card table calendar gantt />
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              boxShadow: '0 4px 14px var(--shadow-coral-mid)',
            }}
          >
            + New project
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>No projects yet. Create your first one!</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            Create project
          </button>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onCardClick={(p) => openDetails(p)}
              onDetailsClick={(p) => openDetails(p)}
              onOpenIde={(p) => router.push(`/ide/dashboard?project=${p.id}`)}
              onArchitectureView={onArchitectureView}
              onArchitectureConfigureRepo={onArchitectureConfigureRepo}
              showDetailsButton
              onAssignedAgentClick={(ac) => {
                const agentHost = agentHostList.find((c) => c.id === ac.id);
                if (agentHost) setSelectedAgentHost(agentHost);
              }}
              onDelete={async (p) => {
                try {
                  await deleteProject(p.id);
                  setProjects((prev) => prev.filter((x) => x.id !== p.id));
                } catch (err) {
                  console.error(err);
                  alert('Failed to delete project');
                }
              }}
            />
          ))}
        </div>
      ) : viewMode === 'calendar' ? (
        <ScheduleCalendar items={projects} getLabel={(p) => p.name} onSelect={(p) => openDetails(p)} />
      ) : viewMode === 'gantt' ? (
        <ScheduleGantt items={projects} getLabel={(p) => p.name} onSelect={(p) => openDetails(p)} noun="project" />
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
              {projects.map((project) => (
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
                        onClick={() => openDetails(project)}
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
                        onClick={() => router.push(taskBoardHref(project.id))}
                        aria-label="Task board"
                        title="Task board"
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
                          <rect x="3" y="4" width="4" height="16" rx="1" />
                          <rect x="10" y="4" width="4" height="11" rx="1" />
                          <rect x="17" y="4" width="4" height="14" rx="1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/workflows?projectId=${project.id}`)}
                        aria-label="View workflows"
                        title={`Workflows${project.workflowCount != null ? ` (${project.workflowCount})` : ''}`}
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
                        <span style={{ fontSize: 16 }} aria-hidden>🔀</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/ide/dashboard?project=${project.id}`)}
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
                      <ArchitectureAnalysisButton
                        project={project}
                        onView={onArchitectureView}
                        onConfigureRepo={onArchitectureConfigureRepo}
                      />
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
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailsProject && (
        <ProjectDetailsPanel
          project={detailsProject}
          open={!!detailsProject}
          initialTab={detailsInitialTab}
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
      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />

      {/* delete dialog used by the table view (prompts to move open tasks first) */}
      <DeleteProjectDialog
        project={confirmProject}
        onCancel={() => setConfirmProject(null)}
        onConfirm={async (project) => {
          try {
            await deleteProject(project.id);
            setProjects((prev) => prev.filter((x) => x.id !== project.id));
            if (detailsProject && detailsProject.id === project.id) {
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
    </div>
  );
}
