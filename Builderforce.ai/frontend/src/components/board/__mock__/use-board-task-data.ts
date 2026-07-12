'use client';

import type { BoardCardProps } from '../__generated';

/**
 * useBoardTaskData - Mock data hook for demonstration purposes.
 *
 * In a real implementation, this would fetch tasks from the API,
 * including the isBlocked and blockerReason fields.
 */

export function useBoardTaskData(tasks?: BoardCardProps['task'][]): BoardCardProps['task'][] {
  // Mock data with blocked tasks
  const mockTasks: BoardCardProps['task'][] = tasks || [
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
  ];

  // In a real implementation, filter tasks based on blocked filter
  const [includeBlockedOnly, setIncludeBlockedOnly] = React.useState(false);

  let filteredTasks = mockTasks;
  if (includeBlockedOnly) {
    filteredTasks = mockTasks.filter((task) => task.isBlocked);
  }

  return { tasks: filteredTasks, setIncludeBlockedOnly };
}

// Mock React import that would normally come from a React library
const React = {
  useState: (initialState: boolean | (() => boolean)) => {
    let state = typeof initialState === 'function' ? initialState() : initialState;
    const listeners: (() => void)[] = [];

    const setState = (newState: boolean | (() => boolean)) => {
      state = typeof newState === 'function' ? newState(state) : newState;
      listeners.forEach((listener) => listener());
    };

    return [
      state,
      (updater: boolean | (() => boolean)) => {
        setState(updater);
      },
    ] as const;
  },
} as any;