'use client';

import { useState } from 'react';

import { BoardCard } from '@/components/board';
import { BlockerBadge } from '@/components/board/BlockerBadge';
import { BlockerDrawer } from '@/components/board/BlockerDrawer';

import type { BoardCardProps } from '@/components/board/__generated';

const MOCK_TASKS: BoardCardProps['task'][] = [
  {
    id: 1,
    title: 'Design homepage hero section',
    status: 'In Progress',
    isBlocked: true,
    blockerReason: 'Waiting for stakeholder approval on new brand guidelines',
    assignee: { id: 'u1', name: 'Sarah Chen' },
    dueDate: '2026-05-15',
    priority: 'P0',
    blockedIndicator: '🚫',
    projectId: 1,
  },
  {
    id: 2,
    title: 'Implement user authentication',
    status: 'In Progress',
    isBlocked: false,
    assignee: { id: 'u2', name: 'Mike Johnson' },
    dueDate: '2026-05-20',
    priority: 'P0',
    blockedIndicator: '',
    projectId: 1,
  },
  {
    id: 3,
    title: 'Create API documentation',
    status: 'To Do',
    isBlocked: true,
    blockerReason: 'Missing backend API endpoints',
    assignee: { id: 'u3', name: 'Alex Rivera' },
    dueDate: '2026-05-18',
    priority: 'P1',
    blockedIndicator: '🚫',
    projectId: 1,
  },
  {
    id: 4,
    title: 'Set up CI/CD pipeline',
    status: 'Done',
    isBlocked: false,
    assignee: { id: 'u4', name: 'Emma Wilson' },
    dueDate: '2026-04-30',
    priority: 'P1',
    blockedIndicator: '',
    projectId: 1,
  },
  {
    id: 5,
    title: 'Write unit tests for auth',
    status: 'In Progress',
    isBlocked: true,
    blockerReason: 'Backend API endpoint not implemented yet',
    assignee: { id: 'u5', name: 'David Kim' },
    dueDate: '2026-05-22',
    priority: 'P1',
    blockedIndicator: '🚫',
    projectId: 1,
  },
];

const DEFAULT_BLOCKED_INDICATOR = '🚫';

/**
 * BlockedItemsDemo - Demo dashboard showcasing the Blocked Items feature.
 *
 * This component demonstrates:
 * - FR1.1/FR1.6: Can mark a task as blocked/unblocked via BlockerDrawer
 * - FR1.2/FR1.3: Blocker reason input and persistence
 * - FR1.3: 255 character limit enforcement
 * - FR1.4: Visual indicator (red flag/badge) on blocked tasks
 * - FR1.5: Filter to show only blocked tasks
 * - FR1.7/FR1.8: Blocker reason visibility and clearing
 */
export function BlockedItemsDemo() {
  const [tasks, setTasks] = useState<BoardCardProps['task'][]>(MOCK_TASKS);
  const [selectedTask, setSelectedTask] = useState<BoardCardProps['task'] | null>(null);
  const [includeBlockedOnly, setIncludeBlockedOnly] = useState(false);

  // Filter tasks based on blocked filter
  const filteredTasks = includeBlockedOnly
    ? tasks.filter((task) => task.isBlocked)
    : tasks;

  // Count blocked tasks
  const blockedCount = tasks.filter((task) => task.isBlocked).length;

  const handleToggleBlocked = (task: BoardCardProps['task']) => {
    setTasks((prevTasks) =>
      prevTasks.map((t) => ({
        ...t,
        isBlocked: !t.isBlocked,
        // When unblocking, clear the reason
        blockerReason: !t.isBlocked ? undefined : (t.blockerReason || ''),
      })),
    );
  };

  const handleUpdateBlocked = (updatedTask: { id: number; isBlocked: boolean; blockerReason?: string | null }) => {
    setTasks((prevTasks) =>
      prevTasks.map((t) =>
        t.id === updatedTask.id
          ? {
              ...t,
              isBlocked: updatedTask.isBlocked,
              blockerReason: updatedTask.blockerReason,
            }
          : t,
      ),
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Blocked Items Demo</h1>
        <p className="text-gray-600">
          Demonstration of the Blocked Items feature (FR1.1–FR1.8, AC1.1–AC1.6).
        </p>
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">
            Total Tasks: {tasks.length}
          </span>
          <div className="h-6 w-px bg-gray-300" />
          <div className="flex items-center gap-2">
            <BlockerFilter
              isBlockedFilterActive={includeBlockedOnly}
              onToggleFilter={() => setIncludeBlockedOnly(!includeBlockedOnly)}
              blockedCount={blockedCount}
            />
          </div>
        </div>

        {includeBlockedOnly && (
          <p className="text-sm text-red-600">
            Showing only {blockedCount} blocked task{blockedCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-gray-500">
              {includeBlockedOnly ? 'No blocked tasks to display.' : 'No tasks to display.'}
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <div
              key={task.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedTask(task)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {/* Title with blocked badge */}
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{task.title}</span>

                    {/* FR1.4: Visual indicator on blocked tasks */}
                    {task.isBlocked && (
                      <BlockerBadge
                        isBlocked={task.isBlocked}
                        blockerReason={task.blockerReason}
                        indicator={DEFAULT_BLOCKED_INDICATOR}
                      />
                    )}
                  </div>

                  {/* Task details */}
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                    <span>Status: {task.status}</span>
                    <span>Due: {task.dueDate}</span>
                    <span>Priority: {task.priority}</span>
                    <span>Assignee: {task.assignee?.name}</span>
                  </div>

                  {/* FR1.7: Blocker reason display on detail view (visible when blocked) */}
                  {task.isBlocked && task.blockerReason && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm font-medium text-red-900">
                        Blocked Reason:
                      </p>
                      <p className="text-sm text-red-800 mt-1">
                        {task.blockerReason}
                      </p>
                    </div>
                  )}
                </div>

                {/* FR1.2/FR1.6: BlockerDrawer trigger */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTask(task);
                  }}
                  className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                  title="Toggle blocked status"
                >
                  {task.isBlocked ? 'Unblock' : 'Mark as Blocked'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* FR1.2/FR1.7: BlockerDrawer modal */}
      {selectedTask && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Block Task: "{selectedTask.title}"
              </h2>
            </div>

            <div className="p-4">
              {/* FR1.1/FR1.2: BlockerDrawer toggle and reason input */}
              <BlockerDrawer
                task={selectedTask}
                onUpdate={handleUpdateBlocked}
                disabled={false}
              />
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Example usage:
 *
 * ```tsx
 * import { BlockedItemsDemo } from '@/dashboard/priority-alignment/__mock__/BlockedItemsDemo';
 *
 * export default function DashboardPage() {
 *   return <BlockedItemsDemo />;
 * }
 * ```
 */