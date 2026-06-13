'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import { ProjectsContent } from '@/components/ProjectsContent';
import PageContainer from '@/components/PageContainer';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';
import { PmScopeProvider } from '@/lib/pm/scope';
import { PmVisualizersContent } from '@/components/pm/PmVisualizersContent';

type Tab = 'projects' | 'tasks' | 'pm';

const TABS: { id: Tab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'pm', label: 'Planning' },
];

/**
 * Projects / Tasks — one domain page with two tabs:
 *  - Projects: the project list (reusable {@link ProjectsContent}).
 *  - Tasks: the task board/list (reusable {@link TaskMgmtContent}).
 *
 * `?tab=tasks` opens the Tasks tab; `?project=<id>` scopes the Tasks board to one
 * project (set by the Task board button on a project). The legacy `/tasks` route
 * redirects here preserving those params.
 */
export default function ProjectsTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const brain = useOptionalBrainContext();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/projects');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  // Active tab is derived from the URL (single source of truth) — no mirrored state.
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = tabParam === 'tasks' ? 'tasks' : tabParam === 'pm' ? 'pm' : 'projects';
  const projectParam = Number(searchParams.get('project'));
  const scopedProjectId = Number.isFinite(projectParam) && projectParam > 0 ? projectParam : undefined;

  // Publish the scoped project to the Brain so "create a task" here defaults to
  // it. Clear on unmount/navigation so the Brain doesn't keep a stale project.
  const setBrainContext = brain?.setContext;
  useEffect(() => {
    if (!setBrainContext) return;
    setBrainContext({ viewingProjectId: scopedProjectId ?? null });
    return () => setBrainContext({ viewingProjectId: null });
  }, [setBrainContext, scopedProjectId]);

  if (!isAuthenticated || !hasTenant) return null;

  const selectTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'projects') params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    router.replace(`/projects${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <PageContainer style={{ padding: '20px 16px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 }}>Projects / Tasks</h1>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 24,
          }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              style={{
                padding: '12px 18px',
                fontSize: 14,
                fontWeight: 600,
                color: activeTab === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'projects' && <ProjectsContent />}
        {activeTab === 'tasks' && <TaskMgmtContent projectId={scopedProjectId} />}
        {activeTab === 'pm' && (
          <PmScopeProvider projectId={scopedProjectId ?? null}>
            <PmVisualizersContent />
          </PmScopeProvider>
        )}
    </PageContainer>
  );
}
