'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ProjectsContent } from '@/components/ProjectsContent';
import { TaskMgmtContent } from '@/components/TaskMgmtContent';

type Tab = 'projects' | 'tasks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
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

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/projects');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  // Active tab is derived from the URL (single source of truth) — no mirrored state.
  const activeTab: Tab = searchParams.get('tab') === 'tasks' ? 'tasks' : 'projects';
  const projectParam = Number(searchParams.get('project'));
  const scopedProjectId = Number.isFinite(projectParam) && projectParam > 0 ? projectParam : undefined;

  const selectTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'tasks') params.set('tab', 'tasks');
    else params.delete('tab');
    const qs = params.toString();
    router.replace(`/projects${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="w-full px-4 py-5">
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

        {activeTab === 'projects' ? (
          <ProjectsContent />
        ) : (
          <TaskMgmtContent projectId={scopedProjectId} />
        )}
      </main>
    </div>
  );
}
