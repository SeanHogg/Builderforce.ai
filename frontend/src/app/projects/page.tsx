'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import { ProjectsContent } from '@/components/ProjectsContent';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';
import { PmScopeProvider } from '@/lib/pm/scope';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PmVisualizersContent } from '@/components/pm/PmVisualizersContent';
import { PmoContent } from '@/components/pm/PmoContent';
import { CeremoniesContent } from '@/components/ceremony/CeremoniesContent';
import { ManagerContent } from '@/components/manager/ManagerContent';
import { KanbanTemplatesContent } from '@/components/KanbanTemplatesContent';
import RfpContent from '@/components/rfp/RfpContent';
import { RoleGate } from '@/components/RoleGate';
import { usePublishNavCount } from '@/lib/navCounts';
import { PROJECTS_COUNT_KEY } from '@/lib/navGroups';
import { WorkspaceCanvas, type WorkspaceCanvasPanel } from '@/components/workspace-canvas/WorkspaceCanvas';
import { signInHref } from '@/lib/auth';

type Tab = 'projects' | 'tasks' | 'manager' | 'pm' | 'portfolio' | 'ceremonies' | 'templates' | 'rfp';

/**
 * Projects — the single destination for all project work. Its sub-views are
 * tabs (rendered by the shared <ShellIndex> in the app shell, driven by
 * lib/navGroups), so none of them is a separate menu item:
 *   - Projects   : the project list.
 *   - Tasks      : the task board/list (`?project=<id>` scopes it).
 *   - Planning   : PM visualizers (gantt/calendar) for the scoped project.
 *   - Portfolio  : the PMO / initiative / OKR cockpit (was /pmo).
 *   - Ceremonies : the standup/planning round-table (was /ceremonies).
 *   - Templates  : the kanban board templates + roles + marketplace (was
 *                  /kanban-templates).
 * The active tab is read from `?tab=` (single source of truth). Legacy /pmo,
 * /ceremonies and /kanban-templates redirect here.
 */
export default function ProjectsTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const { currentProjectId, currentProject, projects } = useProjectScope();
  const brain = useOptionalBrainContext();
  // ProjectsContent fetches the list and reports the count up; we publish it to
  // the shared nav-counts store so the shell <ShellIndex> shows the badge on
  // the Projects tab (the tab bar lives in the app shell, not this page).
  const [projectCount, setProjectCount] = useState<number | null>(null);
  usePublishNavCount(PROJECTS_COUNT_KEY, projectCount);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace(signInHref('/projects'));
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  const tabParam = searchParams.get('tab');
  const activeTab: Tab =
    tabParam === 'tasks' ? 'tasks'
    : tabParam === 'manager' ? 'manager'
    : tabParam === 'pm' ? 'pm'
    : tabParam === 'portfolio' ? 'portfolio'
    : tabParam === 'ceremonies' ? 'ceremonies'
    : tabParam === 'templates' ? 'templates'
    : tabParam === 'rfp' ? 'rfp'
    : 'projects';
  // Project scope comes from the global TopBar tenant→project selector
  // (useProjectScope), so the Planning/Tasks tabs no longer need their own
  // picker and switching projects there carries across every tab.
  const scopedProjectId = currentProjectId ?? undefined;
  const requestedPanelIds = useMemo(() => {
    const values = [searchParams.get('project'), ...(searchParams.get('panels') ?? '').split(',')];
    return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  }, [searchParams]);
  const [taskPanelIds, setTaskPanelIds] = useState<number[]>(requestedPanelIds);
  const [panelProject, setPanelProject] = useState('');

  useEffect(() => {
    if (activeTab !== 'tasks') return;
    setTaskPanelIds((current) => {
      const preferred = requestedPanelIds.length ? requestedPanelIds : (currentProjectId ? [currentProjectId] : []);
      const additions = preferred.filter((id) => !current.includes(id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [activeTab, currentProjectId, requestedPanelIds]);

  const commitTaskPanels = useCallback((ids: number[]) => {
    setTaskPanelIds(ids);
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length > 1) params.set('panels', ids.join(','));
    else params.delete('panels');
    const query = params.toString();
    router.replace(query ? `/projects?${query}` : '/projects', { scroll: false });
  }, [router, searchParams]);

  const removeTaskPanel = useCallback((panelId: string) => {
    const id = Number(panelId.replace(/^tasks-/, ''));
    commitTaskPanels(taskPanelIds.filter((value) => value !== id));
  }, [commitTaskPanels, taskPanelIds]);

  const addTaskPanel = useCallback(() => {
    const id = Number(panelProject);
    if (!Number.isInteger(id) || id <= 0) return;
    if (!taskPanelIds.includes(id)) commitTaskPanels([...taskPanelIds, id]);
    setPanelProject('');
  }, [commitTaskPanels, panelProject, taskPanelIds]);

  // Publish the scoped project to the Brain so "create a task" here defaults to it.
  const setBrainContext = brain?.setContext;
  useEffect(() => {
    if (!setBrainContext) return;
    setBrainContext({ viewingProjectId: scopedProjectId ?? null });
    return () => setBrainContext({ viewingProjectId: null });
  }, [setBrainContext, scopedProjectId]);

  if (!isAuthenticated || !hasTenant) return null;

  // Manager owns a component-level canvas. Rendering it inside the route-level
  // React Flow canvas creates a nested viewport whose measured node can collapse
  // to zero during the async overview load.
  if (activeTab === 'manager') return <ManagerContent projectId={scopedProjectId} />;

  const taskIds = taskPanelIds.length ? taskPanelIds : (scopedProjectId ? [scopedProjectId] : []);
  const panelFor = (id: number, index: number): WorkspaceCanvasPanel => {
    const project = projects.find((candidate) => candidate.id === id);
    return {
      id: `tasks-${id}`,
      title: project?.name ?? `Project ${id}`,
      subtitle: 'Task board',
      icon: '✓',
      content: <TaskMgmtContent projectId={id} projectName={project?.name} compact />,
      position: { x: 56 + index * 90, y: 52 + index * 72 },
      width: 1480,
      height: 820,
      removable: taskIds.length > 1,
    };
  };

  let panels: WorkspaceCanvasPanel[];
  if (activeTab === 'tasks') {
    panels = taskIds.length
      ? taskIds.map(panelFor)
      : [{ id: 'tasks-all', title: 'All project tasks', subtitle: 'Task board', icon: '✓', content: <TaskMgmtContent compact />, width: 1480, height: 820 }];
  } else if (activeTab === 'pm') {
    panels = [{ id: 'planning', title: 'Planning', subtitle: currentProject?.name ?? 'All projects', icon: '↗', content: <PmScopeProvider projectId={scopedProjectId ?? null}><PmVisualizersContent /></PmScopeProvider>, width: 1380, height: 800 }];
  } else if (activeTab === 'portfolio') {
    panels = [{ id: 'portfolio', title: 'Portfolio', subtitle: 'Initiatives and objectives', icon: '▥', content: <RoleGate capability="insights.portfolio" variant="block"><PmoContent /></RoleGate>, width: 1380, height: 800 }];
  } else if (activeTab === 'ceremonies') {
    panels = [{ id: 'ceremonies', title: 'Ceremonies', subtitle: 'Collaborative project rituals', icon: '◎', content: <CeremoniesContent />, width: 1320, height: 780 }];
  } else if (activeTab === 'templates') {
    panels = [{ id: 'templates', title: 'Templates', subtitle: 'Reusable task-board systems', icon: '□', content: <KanbanTemplatesContent />, width: 1320, height: 780 }];
  } else if (activeTab === 'rfp') {
    panels = [{ id: 'rfp', title: 'RFP', subtitle: 'Proposal workspace', icon: '▤', content: <RfpContent />, width: 1320, height: 780 }];
  } else {
    panels = [{ id: 'projects', title: 'Projects', subtitle: 'Reusable project widgets', icon: '▦', content: <ProjectsContent onCount={setProjectCount} />, width: 1320, height: 780 }];
  }

  return (
    <WorkspaceCanvas
      panels={panels}
      onRemovePanel={activeTab === 'tasks' ? removeTaskPanel : undefined}
      toolbar={activeTab === 'tasks' ? <>
        <select value={panelProject} onChange={(event) => setPanelProject(event.target.value)} aria-label="Project for new task panel" className="select">
          <option value="">Add another project…</option>
          {projects.filter((project) => !taskIds.includes(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={!panelProject} onClick={addTaskPanel}>+ Task panel</button>
      </> : undefined}
    />
  );
}
