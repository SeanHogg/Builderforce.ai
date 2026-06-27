'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import { ProjectsContent } from '@/components/ProjectsContent';
import PageContainer from '@/components/PageContainer';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';
import { PmScopeProvider } from '@/lib/pm/scope';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PmVisualizersContent } from '@/components/pm/PmVisualizersContent';
import { PmoContent } from '@/components/pm/PmoContent';
import { CeremoniesContent } from '@/components/ceremony/CeremoniesContent';
import { RoleGate } from '@/components/RoleGate';
import { usePublishNavCount } from '@/lib/navCounts';
import { PROJECTS_COUNT_KEY } from '@/lib/navGroups';

type Tab = 'projects' | 'tasks' | 'pm' | 'portfolio' | 'ceremonies';

/**
 * Projects — the single destination for all project work. Its sub-views are
 * tabs (rendered by the shared <SectionTabs> bar in the app shell, driven by
 * lib/navGroups), so none of them is a separate menu item:
 *   - Projects   : the project list.
 *   - Tasks      : the task board/list (`?project=<id>` scopes it).
 *   - Planning   : PM visualizers (gantt/calendar) for the scoped project.
 *   - Portfolio  : the PMO / initiative / OKR cockpit (was /pmo).
 *   - Ceremonies : the standup/planning round-table (was /ceremonies).
 * The active tab is read from `?tab=` (single source of truth). Legacy /pmo and
 * /ceremonies redirect here.
 */
export default function ProjectsTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const { currentProjectId } = useProjectScope();
  const brain = useOptionalBrainContext();
  // ProjectsContent fetches the list and reports the count up; we publish it to
  // the shared nav-counts store so the shell <SectionTabs> bar shows the badge on
  // the Projects tab (the tab bar lives in the app shell, not this page).
  const [projectCount, setProjectCount] = useState<number | null>(null);
  usePublishNavCount(PROJECTS_COUNT_KEY, projectCount);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/projects');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  const tabParam = searchParams.get('tab');
  const activeTab: Tab =
    tabParam === 'tasks' ? 'tasks'
    : tabParam === 'pm' ? 'pm'
    : tabParam === 'portfolio' ? 'portfolio'
    : tabParam === 'ceremonies' ? 'ceremonies'
    : 'projects';
  // Project scope comes from the global TopBar tenant→project selector
  // (useProjectScope), so the Planning/Tasks tabs no longer need their own
  // picker and switching projects there carries across every tab.
  const scopedProjectId = currentProjectId ?? undefined;

  // Publish the scoped project to the Brain so "create a task" here defaults to it.
  const setBrainContext = brain?.setContext;
  useEffect(() => {
    if (!setBrainContext) return;
    setBrainContext({ viewingProjectId: scopedProjectId ?? null });
    return () => setBrainContext({ viewingProjectId: null });
  }, [setBrainContext, scopedProjectId]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer style={{ padding: '20px 16px' }}>
      {activeTab === 'projects' && <ProjectsContent onCount={setProjectCount} />}
      {activeTab === 'tasks' && <TaskMgmtContent projectId={scopedProjectId} />}
      {activeTab === 'pm' && (
        <PmScopeProvider projectId={scopedProjectId ?? null}>
          <PmVisualizersContent />
        </PmScopeProvider>
      )}
      {activeTab === 'portfolio' && (
        <RoleGate capability="insights.portfolio" variant="block">
          <PmoContent />
        </RoleGate>
      )}
      {activeTab === 'ceremonies' && <CeremoniesContent />}
    </PageContainer>
  );
}
