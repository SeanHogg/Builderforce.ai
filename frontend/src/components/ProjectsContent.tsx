'use client';

import { Icon } from '@/components/ui/Icon';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { ProjectDiagnosticSummary } from '@/lib/tools';
import type { AgentHost } from '@/lib/builderforceApi';
import { toolsApi } from '@/lib/builderforceApi';
import { fetchProjects, createProject, deleteProject, updateProject } from '@/lib/api';
import type { ReschedulePatch } from '@/lib/schedule';
import { fetchProjectConnections, type ProjectConnection } from '@/lib/projectConnections';
import { trackActivity } from '@/lib/activity/tracker';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { agentHosts } from '@/lib/builderforceApi';
import { ProjectDetailsPanel } from '@/components/ProjectDetailsPanel';
import type { ProjectPanelTab } from '@/components/project-details/projectPanelTabs';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectTable } from '@/components/ProjectTable';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ViewToggle } from '@/components/ViewToggle';
import { ScheduleCalendar } from '@/components/ScheduleCalendar';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { computeProjectHealth } from '@/lib/projectHealth';
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';

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
 * Projects content — full project list, create-project modal, open project → Canvas Builder.
 *
 * Reusable: rendered standalone by the Projects/Tasks page (Projects tab) and as
 * the Dashboard preview (with `limit`/`viewAllHref`), so the cards, table, button
 * group, and data source can't drift between the two surfaces. Auth gating is the
 * parent's job; this component fetches its own data, mirroring {@link TaskMgmtContent}.
 */
export function ProjectsContent({ limit, viewAllHref, onCount }: ProjectsContentProps = {}) {
  const t = useTranslations('projectsContent');
  const tSchedule = useTranslations('schedule');
  const router = useRouter();
  const searchParams = useSearchParams();
  // Global project scope (present in the app shell): when a single project is
  // selected in the TopBar, the list narrows to just that project so this
  // surface shows the same scope as every other page.
  const scope = useOptionalProjectScope();

  const [projects, setProjects] = useState<Project[]>([]);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  // Per-project latest diagnostic scores (SOC 2, Quality, …), from the single
  // cached workspace rollup — so every card renders its diagnostics strip
  // without an N+1 per-card score fetch. Manager-gated: a 403 leaves the map
  // empty and the strips self-hide.
  const [diagnosticsByProject, setDiagnosticsByProject] = useState<Map<number, ProjectDiagnosticSummary[]>>(new Map());
  // Per-project connections (repos, external boards) with live health, latest
  // build verdict and open-PR count — one tenant-wide cached read, so every card
  // shows its integration status without an N+1 per-card provider probe. Loaded
  // independently of the project list so a slow provider never delays the grid.
  const [connectionsByProject, setConnectionsByProject] = useState<Map<number, ProjectConnection[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsProject, setDetailsProject] = useState<Project | null>(null);
  const [detailsInitialTab, setDetailsInitialTab] = useState<ProjectPanelTab>('analytics');
  const [detailsInitialSpecKind, setDetailsInitialSpecKind] = useState<string | null>(null);
  const [detailsInitialAudit, setDetailsInitialAudit] = useState<string | null>(null);
  const [detailsInitialSpecId, setDetailsInitialSpecId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ProjectsView>('card');
  const [selectedAgentHost, setSelectedAgentHost] = useState<AgentHost | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  // Narrow to the globally-selected project (if any), then apply the preview cap.
  const scopedProjectId = scope?.currentProjectId ?? null;
  const scopedProjects = scopedProjectId != null ? projects.filter((p) => p.id === scopedProjectId) : projects;
  const visibleProjects = limit != null ? scopedProjects.slice(0, limit) : scopedProjects;

  const loadRollup = useCallback(() => {
    toolsApi.rollup()
      .then((r) => setDiagnosticsByProject(new Map(r.projects.map((p) => [p.projectId, p.diagnostics]))))
      .catch(() => setDiagnosticsByProject(new Map()));
  }, []);

  // fetchProjectConnections already resolves to an empty map on failure — the
  // strips self-hide, and the projects list never surfaces an error for it.
  const loadConnections = useCallback(() => {
    void fetchProjectConnections().then(setConnectionsByProject);
  }, []);

  useEffect(() => {
    Promise.all([
      fetchProjects().catch(() => {
        setError(t('errLoad'));
        return [] as Project[];
      }),
      agentHosts.list().catch(() => [] as AgentHost[]),
    ]).then(([projs, agentHostsData]) => {
      setProjects(projs);
      setAgentHostList(agentHostsData);
    }).finally(() => setIsLoading(false));
    loadRollup();
    loadConnections();
    // Mount-only fetch; `t` (next-intl) is stable and only used in the error path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch the project list when the Brain creates/updates/deletes a project,
  // so this list stays live instead of going stale until a manual reload.
  const reloadProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
    loadRollup();
    loadConnections();
  }, [loadRollup, loadConnections]);
  useBrainDataRefresh(['projects'], reloadProjects);

  useEffect(() => {
    if (searchParams.get('create') === '1') setShowForm(true);
  }, [searchParams]);

  // Deep-link into a project's information panel. Two callers today:
  //   ?project=<id>&panel=diagnostics&audit=<id>  — an audit-complete notification
  //   ?project=<id>&panel=prds&spec=<id>          — "Open" on a PRD a Brain chat created
  // Both land on the DOCUMENT/result, not merely the tab that lists it (see
  // `artifactRoutePath`). Runs once the list is loaded so the project can be resolved.
  useEffect(() => {
    const pid = searchParams.get('project');
    const panel = searchParams.get('panel');
    if (!pid || !panel || projects.length === 0) return;
    const proj = projects.find((p) => String(p.id) === pid);
    if (!proj) return;
    setDetailsInitialTab(panel as ProjectPanelTab);
    setDetailsInitialAudit(searchParams.get('audit'));
    setDetailsInitialSpecId(searchParams.get('spec'));
    setDetailsProject(proj);
  }, [searchParams, projects]);

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
      // Audited engagement signal: creating/updating a project is billable activity.
      trackActivity('project_update', { ref: `project:${project.id}`, projectId: project.id });
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
        setError(t('errCreate'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  // Open the project Information panel on a given tab. Used by the Details button
  // (default tab) and the Architect button (PRDs to read the result, or
  // Integrations when a repo must be mapped before a run can start).
  const openDetails = (project: Project, tab: ProjectPanelTab = 'analytics', specKind?: string) => {
    setDetailsInitialTab(tab);
    // Which document the destination tab should open, not just which tab. Cleared
    // on every open so a later plain Details click doesn't inherit the last one.
    setDetailsInitialSpecKind(specKind ?? null);
    setDetailsInitialSpecId(null);
    setDetailsProject(project);
  };

  /**
   * Fold a project PATCH response back into the list row.
   *
   * The PATCH response carries only the editable domain fields, so it must be
   * MERGED over the list row rather than replacing it — otherwise the derived
   * list-only fields (task/health counts, workflowCount, delivery signals) would
   * be wiped until a reload, blanking the card's health visuals.
   *
   * Both project dates need the same two-line treatment and get it here rather
   * than at each call site: the response's `startDate`/`dueDate` are the EXPLICIT
   * values, so they become `projectStartDate`/`projectDueDate`, while the
   * EFFECTIVE date falls back to the previously-resolved (possibly task-derived)
   * one when the explicit value is cleared. Shared by the details panel and the
   * Gantt/Calendar drag, which is precisely why it is one function: a reschedule
   * that merged differently from an edit would leave two rows on the same board
   * disagreeing about which date is derived.
   */
  const mergeProjectPatch = useCallback((prev: Project, updated: Project): Project => ({
    ...prev,
    ...updated,
    assignedAgentHost: prev.assignedAgentHost,
    projectStartDate: updated.startDate ?? null,
    startDate: updated.startDate ?? prev.startDate ?? null,
    projectDueDate: updated.dueDate ?? null,
    dueDate: updated.dueDate ?? prev.dueDate ?? null,
  }), []);

  const applyProjectPatch = useCallback((updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? mergeProjectPatch(p, updated) : p)));
    setDetailsProject((p) => (p && p.id === updated.id ? mergeProjectPatch(p, updated) : p));
  }, [mergeProjectPatch]);

  /** Persist a bar dragged on the Gantt / a span dragged on the Calendar. */
  const rescheduleProject = useCallback(async (project: Project, patch: ReschedulePatch) => {
    try {
      const updated = await updateProject(project.publicId ?? project.id, patch);
      applyProjectPatch(updated);
    } catch (err) {
      console.error(err);
      setError(tSchedule('rescheduleFailed'));
    }
  }, [applyProjectPatch, tSchedule]);

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
      alert(t('errDelete'));
    }
  }, [scope, t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-tour="demo-board">
      {/* New Project panel */}
      <SlideOutPanel open={showForm} onClose={() => setShowForm(false)} title={t('newProjectTitle')} width="min(480px, 96vw)">
        <form onSubmit={handleCreate} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('nameLabel')}
            </label>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('namePlaceholder')}
              required
              style={{
                width: '100%',
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '10px 14px',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('descLabel')}
            </label>
            <input
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              placeholder={t('descPlaceholder')}
              style={{
                width: '100%',
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '10px 14px',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || !newProjectName.trim()}
              style={{
                padding: '8px 18px',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-lg)',
                cursor: isCreating || !newProjectName.trim() ? 'not-allowed' : 'pointer',
                opacity: isCreating || !newProjectName.trim() ? 0.7 : 1,
              }}
            >
              {isCreating ? t('creating') : t('create')}
            </button>
          </div>
        </form>
      </SlideOutPanel>

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}
        >
          {error}
        </div>
      )}

      {/* Keep the live fleet and its master stop visible on the full Projects page.
          Dashboard previews of this reusable component stay compact. */}
      {limit == null && <ActiveRunsPanel />}

      {/* The project count lives on the surrounding tab (see TabCountBadge), so
          this row only holds the controls, right-aligned. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} card table calendar gantt />
          {viewAllHref && (
            <Link href={viewAllHref} style={{ fontSize: 13, fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none' }}>
              {t('viewAll')}
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
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              boxShadow: '0 4px 14px var(--shadow-coral-mid)',
            }}
          >
            {t('newProjectBtn')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>{t('loading')}</div>
      ) : projects.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}><Icon source="🚀" size="1em" /></div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{t('emptyTitle')}</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('createProject')}
          </button>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              diagnostics={diagnosticsByProject.get(project.id)}
              connections={connectionsByProject.get(project.id)}
              onCardClick={(p) => openDetails(p)}
              onDetailsClick={openDetails}
              onOpenBuilder={(p) => router.push(`/create?filter=build&project=${p.id}`)}
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
        <ScheduleCalendar
          items={visibleProjects}
          getLabel={(p) => p.name}
          onSelect={(p) => openDetails(p)}
          onReschedule={rescheduleProject}
          getAccentColor={(p) => {
            const h = computeProjectHealth(p);
            return h.hasData ? h.color : undefined;
          }}
        />
      ) : viewMode === 'gantt' ? (
        <ScheduleGantt
          items={visibleProjects}
          getLabel={(p) => p.name}
          onSelect={(p) => openDetails(p)}
          columnLabel={tSchedule('columnProject')}
          emptyMessage={tSchedule('emptyProjects')}
          onReschedule={rescheduleProject}
        />
      ) : (
        <ProjectTable
          projects={visibleProjects}
          diagnosticsByProject={diagnosticsByProject}
          connectionsByProject={connectionsByProject}
          onDetailsClick={openDetails}
          onOpenBuilder={(p) => router.push(`/create?filter=build&project=${p.id}`)}
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
          initialSpecKind={detailsInitialSpecKind}
          initialSpecId={detailsInitialSpecId}
          initialAuditId={detailsInitialAudit}
          onClose={() => { setDetailsProject(null); setDetailsInitialAudit(null); setDetailsInitialSpecId(null); }}
          onProjectUpdate={applyProjectPatch}
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
