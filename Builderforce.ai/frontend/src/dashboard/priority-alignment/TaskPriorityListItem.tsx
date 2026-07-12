/**
 * Individual Task Priority List Item Component
 *
 * Used within the PriorityAlignmentDashboard table.
 */

import React from 'react';
import { PriorityBadge, PriorityIcon } from '../../components/tasks/PriorityBadge';
import { PriorityTask } from '../../types/services';

export interface TaskPriorityListItemProps {
  task: PriorityTask;
  onAssign?: (task: PriorityTask) => void;
}

export function TaskPriorityListItem({ task, onAssign }: TaskPriorityListItemProps) {
  const priorityIcons = {
    high: (
      <svg className="w-5 h-5 text-red-600" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
    ),
    medium: (
      <svg className="w-5 h-5 text-amber-600" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
    low: (
      <svg className="w-5 h-5 text-gray-600" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">{priorityIcons[task.priority]}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {task.title}
          </p>
          <p className="text-xs text-gray-500">{task.key}</p>
        </div>
        <PriorityBadge priority={task.priority} size="sm" />
      </div>
      <div className="flex items-center gap-4 pl-8">
        <span className="text-xs text-gray-600">
          Project: {task.projectId}
        </span>
        {task.dueDate && (
          <span className="text-xs text-gray-600">
            Due: {task.dueDate}
          </span>
        )}
      </div>
    </div>
  );
}