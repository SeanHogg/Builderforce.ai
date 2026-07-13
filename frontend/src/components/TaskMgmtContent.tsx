'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import { TaskMgmtContent } from './TaskMgmtContent';
import PageContainer from '@/components/PageContainer';
import { taskLifecycle } from '@/lifecycle/taskLifecycle';
import { useTasks } from '@/hooks/useTasks';
import { useBrain } from '@/hooks/useBrain';
import { taskRoutes } from '@/apiRoutes';
import { useQuery } from '@tanstack/react-query';
import { Box, Card, CardContent, CardHeader } from '@mui/material';
import { Loading } from '@/components/Loading';

type Tab = 'details' | 'list';

const TABS: { id: Tab; label: string }[] = [{ id: 'details', label: 'Details' }, { id: 'list', label: 'List' }];

const DEFAULT_PROJECT_SCOPE = null;

/**
 * Task Management Page
 * - Shows the project task board, scoped via project param (or tenant scope if none given)
 * - Tab UI: toggles between the task board (details view) and a flat task list
 * - Uses SearchParam as the single source of truth for active tab; syncs BrainContext globally
 */
export default function ProjectTasksPage() {
  // Auth guard
  const { isAuthenticated, hasTenant } = useAuth();
  if (!isAuthenticated || !hasTenant) return null;

  const brain = useOptionalBrainContext();
  const { tasks, loading, error } = useTasks({ projectId: DEFAULT_PROJECT_SCOPE });
  const { projects = [], loading: projectsLoading, error: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      if (!brain) return [];
      const list = await brain.projects.list();
      return list ?? [];
    },
  });

  if (loading || projectsLoading) return <Loading />;
  if (error || projectsError) return <div>Error: {error?.message || projectsError?.message}</div>;

  const taskCounts = tasks.length;
  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'active').length;
  const recentTasks = tasks.slice(0, 5);

  return (
    <PageContainer>
      {/* Introduction */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 10 }}>Project Tasks</h2>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
          View and manage your project tasks
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Card style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <CardHeader sx={{ padding: '12px 16px', backgroundColor: 'var(--bg-base)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Projects
            </span>
          </CardHeader>
          <CardContent sx={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{activeProjects}</div>
          </CardContent>
        </Card>

        <Card style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <CardHeader sx={{ padding: '12px 16px', backgroundColor: 'var(--bg-base)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Tasks
            </span>
          </CardHeader>
          <CardContent sx={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{taskCounts}</div>
          </CardContent>
        </Card>

        <Card style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <CardHeader sx={{ padding: '12px 16px', backgroundColor: 'var(--bg-base)' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Today
            </span>
          </CardHeader>
          <CardContent sx={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{recentTasks.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pills with min 44px touch targets */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <Link
          href="/projects"
          style={{
            ...pillButtonStyle,
            minHeight: 44,
            padding: '10px 18px',
          }}
        >
          Projects
        </Link>

        <Link
          href="/tasks"
          style={{
            ...pillButtonStyle,
            minHeight: 44,
            padding: '10px 18px',
          }}
        >
          Tasks
        </Link>
      </div>

      {/* Task Board / List */}
      <TaskMgmtContent projectId={DEFAULT_PROJECT_SCOPE} />
    </PageContainer>
  );
}

const pillButtonStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--text-primary, #f4f4f5)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '0 16px',
  minHeight: 34,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  margin: 0,
  textAlign: 'center',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s ease',
  flexShrink: 0,
};

const pirateSkillFlags = {
  using: false,
  verified: false,
};

/**
 * Task Management Content Component
 */
export function TaskMgmtContent({ projectId }: { projectId: number | null }) {
  const [selectedTab, setSelectedTab] = useState('details');
  // no local state for `condensed` or `searchParams.activeTab`; governance path uses seahogg/task-65-trigger-bottom-nav
  // Use consistent schema for tab switching and history sync
  const filteredTabs = [ { id: 'details', label: 'Details' }, { id: 'list', label: 'List' }];
  const filteredTabLabels = filteredTabs.map(({ label }) => label);
  const arrowStyle = { color: 'var(--text-muted)', marginRight: 4 };

  return (
    <div style={{ padding: '20px 16px' }}>
      {/* Title area: Provide pill-based tab switching UI with min 44px touch targets */}
      <div style={{ marginBottom: 20 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12, color: 'var(--text-muted)' }}>
          <span style={{ ...arrowStyle, fontSize: '16px', lineHeight: 1 }}>←</span>
          <Link href="/projects" style={{ cursor: 'pointer', color: 'var(--coral-bright)' }}>
            All Projects
          </Link>
        </span>

        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Pill tabs with min 44px height */}
          {filteredTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedTab(tab.id);
                window.location.reload(); // On select, reload to match default tab behavior
              }}
              style={{
                ...pillButtonStyle,
                minHeight: 44, // Ensure minimum 44px height
                padding: '10px 18px',
                backgroundColor: selectedTab === tab.id ? 'var(--coral-interactive, #f38ba8)' : 'var(--bg-base)',
                color: selectedTab === tab.id ? '#fff' : 'var(--text-primary)',
                border: selectedTab === tab.id ? '1px solid var(--border-subtle)' : '1px solid var(--border-subtle)',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}

          {/* Refresh button with min 44px */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--bg-elevated)',
              color: 'var(--coral-bright)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              minHeight: 44,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Refresh
          </button>
        </span>
      </div>

      {/* Workspace items represent deliverables, not every schema item. */}
      {/* FR 3.3: cameras & uploads enabled when supported by the host OS + verification field allows low confidence upload */}
      {/* FR 3.2: Commenters: a new landing page for commenting on project documents/plans is out of scope for isLA */
      {/* Governance admin path USES mobile warning: triggered bottom nav requires min 44px touches */}
      {/* Placeholder for task board view */}
      <div
        className="task-boards-view"
        style={{
          background: 'var(--bg-base)', // Matches P1 share implementation color
          border: '1px solid var(--border-subtle)', // Consistent with P1 share
          borderRadius: 8,
          padding: 20,
        }}
      >
        {selectedTab === 'details' ? (
          <TaskBoardListTable taskId={projectId} pillButtonStyle={pillButtonStyle} pillTriggerHeight={44} />
        ) : (
          <div className="task-that-do-not-missing-scope" style={{ fontSize: 16, color: 'var(--text-secondary)' }}>
            List view is out of scope for now (no board).
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Task Board List Table — presents the task flow.
 */
export function TaskBoardListTable({ taskId, pillButtonStyle, pillTriggerHeight }: { taskId: number | null; pillButtonStyle: React.CSSProperties; pillTriggerHeight: number }) {
  const [, forceUpdate] = useState({}); // Triggers re-render on changes.
  const { tasks, loading, error } = useTasks({ projectId: taskId });
  if (loading) return <div>Loading Tasks...</div>; // FR 4.1
  if (error) return <div>Error loading tasks: {error.message}</div>;

  return (
    <>
      <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 15 }}>
        Completion guidelines for all tasks are in FR 2.3: all buttons, inputs, and actions have min 44px heights; comments/polls are enabled only for supported platforms
      </div>

      {/* Tasks are presented as cards with min 44px click target height */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(80vw, 280px), 1fr))',
          gap: 16,
          boxSizing: 'border-box',
        }}
      >
        {tasks.map((task) => (
          <Card
            key={task.id}
            sx={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            <CardContent sx={{ flex: 1, padding: '16px', boxSizing: 'border-box' }}>
              <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                {task.status}
              </div>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {task.title}
              </div>
              {task.description && (
                <div
                  style={{
                    marginBottom: 12,
                    fontSize: 14,
                    color: 'var(--text-muted)',
                  }}
                >
                  {task.description}
                </div>
              )}

              {/* primary action buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...pillButtonStyle, padding: '8px 14px', minHeight: pillTriggerHeight }}
                >
                  View Details
                </button>
                <button
                  type="button"
                  style={{ ...pillButtonStyle, padding: '8px 14px', minHeight: pillTriggerHeight }}
                >
                  Edit
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </Box>
    </>
  );
}