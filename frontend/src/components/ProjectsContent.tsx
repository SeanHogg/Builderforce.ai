'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { AgentHost } from '@/lib/builderforceApi';
import { fetchProjects, createProject, deleteProject } from '@/lib/api';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { agentHosts } from '@/lib/builderforceApi';
import { ProjectDetailsPanel, type ProjectPanelTab } from '@/components/ProjectDetailsPanel';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectTable } from '@/components/ProjectTable';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ViewToggle } from '@/components/ViewToggle';
import { ScheduleCalendar } from '@/components/ScheduleCalendar';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

type ProjectsView = 'card' | 'table' | 'calendar' | 'gantt';

export interface ProjectsContentProps {
  /** Cap the rendered list (dashboard preview). Omit to show every project. */
  limit?: number;
  /** When set, render a "View all" link to this href (dashboard preview). */
  viewAllHref?: string;
  /**
   * Report the live project count to the parent so it can render the count on
   * the surrounding tab (this component no longer shows its own count line).
   * Fires on load and on every create/delete.
   */
  onCount?: (count: number) => void;
}

/**
 * Projects content — full project list, create-project modal, open project → IDE.
 *
 * Reusable: rendered standalone by the Projects/Tasks page (Projects tab) and as
 * the Dashboard preview (with `limit`/`viewAllHref`), so the cards, table, button
 * group, and data source can't drift between the two surfaces. Auth gating is the
 * parent's job; this component fetches its own data, mirroring {@link TaskMgmtContent}.
 */
export function ProjectsContent({ limit, viewAllHref, onCount }: ProjectsContentProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Global project scope (present in the app shell): when a single project is
  // selected in the TopBar, the list narrows to just that project so this
  // surface shows the same scope as every other page.
  const scope = useOptionalProjectScope();

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
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  // Narrow to the globally-selected project (if any), then apply the preview cap.
  const scopedProjectId = scope?.currentProjectId ?? null;
  const scopedProjects = scopedProjectId != null ? projects.filter((p) => p.id === scopedProjectId) : projects;
  const visibleProjects = limit != null ? scopedProjects.slice(0, limit) : scopedProjects;

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

  // Refetch the project list when the Brain creates/updates/deletes a project,
  // so this list stays live instead of going stale until a manual reload.
  const reloadProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);
  useBrainDataRefresh(['projects'], reloadProjects);

  useEffect(() => {
    if (searchParams.get('create') === '1') setShowForm(true);
  }, [searchParams]);

  // Surface the count to the parent (tab badge) instead of rendering it here.
  // Reports the SCOPED count so the badge matches what is shown; re-fires on
  // create/delete and when the global project scope changes.
  useEffect(() => {
    onCount?.(scopedProjects.length);
  }, [scopedProjects.length, onCount]);

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
      scope?.reload();
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

  // Single delete path shared by the card / table / details-panel actions:
  // remove locally, close the panel if it was open, clear the global scope if it
  // pointed at the deleted project, and refresh the shared project list.
  const removeProject = useCallback(async (p: Project) => {
    try {
      await deleteProject(p.id);
      setProjects((prev) => prev.filter((x) => x.id !== p.id));
      setDetailsProject((cur) => (cur && cur.id === p.id ? null : cur));
      if (scope?.currentProjectId === p.id) scope.setProject(null);
      scope?.reload();
    } catch (err) {
      console.error(err);
      alert('Failed to delete project');
    }
  }, [scope]);

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

      {/* The project count lives on the surrounding tab (see TabCountBadge), so
          this row only holds the controls, right-aligned. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} card table calendar gantt />
          {viewAllHref && (
            <Link href={viewAllHref} style={{ fontSize: 13, fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none' }}>
              View all
            </Link>
          )}
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
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onCardClick={(p) => openDetails(p)}
              onDetailsClick={openDetails}
              onOpenIde={(p) => router.push(`/ide/dashboard?project=${p.id}`)}
              showDetailsButton
              onAssignedAgentClick={(ac) => {
                const agentHost = agentHostList.find((c) => c.id === ac.id);
                if (agentHost) setSelectedAgentHost(agentHost);
              }}
              onDelete={removeProject}
            />
          ))}
        </div>
      ) : viewMode === 'calendar' ? (
        <ScheduleCalendar items={visibleProjects} getLabel={(p) => p.name} onSelect={(p) => openDetails(p)} />
      ) : viewMode === 'gantt' ? (
        <ScheduleGantt items={visibleProjects} getLabel={(p) => p.name} onSelect={(p) => openDetails(p)} noun="project" />
      ) : (
        <ProjectTable
          projects={visibleProjects}
          onDetailsClick={openDetails}
          onOpenIde={(p) => router.push(`/ide/dashboard?project=${p.id}`)}
          onAssignedAgentClick={(ac) => {
            const agentHost = agentHostList.find((c) => c.id === ac.id);
            if (agentHost) setSelectedAgentHost(agentHost);
          }}
          onDelete={removeProject}
        />
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
          onDelete={removeProject}
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
    </div>
  );
}
