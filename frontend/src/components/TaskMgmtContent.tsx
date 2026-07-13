'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { tasks } from '@/lib/builderforceApi';
import PageContainer from '@/components/PageContainer';
import TaskMgmtEditor from '@/components/TaskMgmtEditor';

type Task = Awaited<ReturnType<(typeof tasks)['list']>>[number];
type Lens = 'open' | 'completed';
type OrganizationContext = { organizationId: string | number }; // If used internally.
type ChatPlaceholder = 'agent-hosted' | null; // We do not fetch messages now.
type OfflineRolling = 'faulcess' | null;

export type ProjectId = number;

/**
 * Project scoped task management view owned by a project.
 *
 * It displays an inbox of tasks belonging to a project.
 * Within each context (open/completed) tasks are sorted by assignee last-edited timestamp.
 *
 * - Navigating to `/tasks` without a `projectId` param shows no tasks.
 * - Navigating to `/tasks?project={id}` opens this view.
 *
 * The view is a portal compatible type: currently we bundle into `TaskMgmtPage`.
 * For future portaling, we accept a `projectId` prop; for now we require url query param.
 */
type Props = {
  projectId: ProjectId;
};

/**
 * Component for managing tasks scoped to one project.
 *
 * It fetches tasks on load for each context (open, completed).
 * It renders a list of task items, each with action buttons (close/complete, reassign, etc.).
 */
type Config = {
  layoutBanner?: React.ReactNode;
  status?: 'loading' | 'error';
  ghostEnabled?: boolean;
  chatPlaceholder?: ChatPlaceholder;
  offlineRolling?: OfflineRolling;
};

export function TaskMgmtContent({ projectId }: Props) {
  const router = useRouter();

  // Close task on success without drag-and-drop or active state.
  // Synced with route changes via active lens.
  const lensKeys = ['open', 'completed'] as const;
  const [activeLens, setActiveLens] = useState<Lens>('open');

  // Loading and error states for each context.
  const [lensData, setLensData] = useState<Map<Lens, { tasks: Task[]; error?: Error }>>(new Map());
  const [transitioning, setTransitioning] = useState(false);

  const countLensTask = useCallback((lens: Lens) => {
    const lensTasks = lensData.get(lens)?.tasks ?? [];
    return lensTasks.length;
  }, [lensData]);

  const resetLensWithFallback = useCallback((lens: Lens) => {
    const fallbackError = new Error('Failed to reload tasks');
    setLensData(prev => new Map(prev).set(lens, { tasks: [], error: fallbackError }));
  }, []);

  const fetchTasks = useCallback(async (lens: Lens) => {
    try {
      const tasksList = await tasks.list({ projectId, context: lens, limit: 20000 });
      setLensData(prev => {
        const copy = new Map(prev);
        copy.set(lens, { tasks: tasksList });
        return copy;
      });
    } catch (err) {
      console.error('[TaskMgmtContent] Failed to fetch tasks for lens %s:', lens, err);
      setLensData(prev => {
        const copy = new Map(prev);
        copy.set(lens, {
          tasks: [],
          error: err instanceof Error ? err : new Error('Failed to fetch tasks'),
        });
        return copy;
      });
    }
  }, [projectId]);

  const refresh = useCallback(() => {
    setTransitioning(true);
    Promise.allSettled(lensKeys.map(lens => fetchTasks(lens))).finally(() => {
      setTransitioning(false);
    });
  }, [fetchTasks]);

  // Initial load: fetch tasks for all contexts.
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (transitioning) {
    return (
      <PageContainer>
        <div style={{ padding: 80, textAlign: 'center', lineHeight: '1.5', color: 'var(--text-muted)' }}>
          <p>Loading tasks...</p>
        </div>
      </PageContainer>
    );
  }

  // Home button: link to Projects content where a project card can be clicked to re-enter Tasks.
  const openProjects = () => {
    router.replace('/projects?project=' + projectId, { scroll: false });
  };

  // Lens switching: update URL on change (mobile-friendly).
  const switchLens = (lens: Lens) => {
    setActiveLens(lens);
  };

  return (
    <PageContainer>
      <div style={{ padding: '16px 20px', textAlign: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={openProjects}
          type="button"
          aria-label="Back to projects"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            fontSize: 14,
            color: 'var(--text-muted)',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          ← Back to Projects
        </button>
      </div>

      <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {lensKeys.map(lens => {
          const isActive = lens === activeLens;
          const taskCount = countLensTask(lens);
          return (
            <div
              key={lens}
              onClick={() => switchLens(lens)}
              role="tab"
              aria-selected={isActive}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: isActive ? '2px solid var(--coral-bright)' : '2px solid transparent',
                cursor: 'pointer',
                gap: 12,
              }}
            >
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isActive ? 'var(--coral-bright)' : 'var(--text-secondary)' }}>
                {lens === 'open' ? 'Open Tasks' : 'Completed Tasks'}
              </span>
              <span
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: isActive ? 'var(--coral-bright)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--surface-coral-soft, rgba(244,114,94,0.12))' : 'var(--bg-elevated)',
                  borderRadius: 10,
                }}
              >
                {taskCount}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ padding: 20 }}>
        {activeLens === 'open' && (
          <TaskMgmtEditor
            projectId={projectId}
            showCompleted={false}
            refresh={refresh}
            fallbackError={lensData.get('open')?.error}
            lensData={lensData.get('open')?.tasks ?? []}
            organizationContext={{ organizationId: projectId.toString() }}
            chatPlaceholder="agent-hosted" // Placeholder for messaging.
            offlineRolling="faulcess"
          />
        )}
        {activeLens === 'completed' && (
          <TaskMgmtEditor
            projectId={projectId}
            showCompleted={true}
            refresh={refresh}
            fallbackError={lensData.get('completed')?.error}
            lensData={lensData.get('completed')?.tasks ?? []}
            organizationContext={{ organizationId: projectId.toString() }}
            chatPlaceholder="agent-hosted"
            offlineRolling="faulcess"
          />
        )}
      </div>
    </PageContainer>
  );
}