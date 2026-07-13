import React from 'react';
import { PriorityBadge } from '../PriorityBadge';
import type { Task } from './types';

/**
 * TaskListView — list-shaped display of project tasks.
 *
 * FR1/AC1: Visual priority indicators are rendered for every task in the list
 * using the shared PriorityBadge component.
 *
 * Kept intentionally thin: presentational only, so the consumer decides how
 * to fetch, filter, and route row actions. Each row prominently shows the
 * priority badge beside the title so PMs, leads, and ICs can scan importance
 * at a glance.
 */

export interface TaskListViewProps {
  tasks: Task[];
  loading?: boolean;
  selectedTaskId?: string | number | null;
  onSelectTask?: (task: Task) => void;
  emptyTitle?: string;
  emptyHint?: string;
}

export function TaskListView({
  tasks,
  loading = false,
  selectedTaskId,
  onSelectTask,
  emptyTitle = 'No tasks yet',
  emptyHint = 'Create a task to start tracking work.',
}: TaskListViewProps) {
  if (loading) {
    return (
      <div
        className="task-list-loading"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 56,
              borderRadius: 8,
              background: 'var(--bf-surface-elevated, rgba(128,128,128,0.08))',
              animation: 'pulse 1.6s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div
        className="task-list-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 16px',
          color: 'var(--bf-text-secondary, #a1a1a1)',
          textAlign: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600 }}>{emptyTitle}</span>
        <span style={{ fontSize: 13 }}>{emptyHint}</span>
      </div>
    );
  }

  return (
    <div
      className="task-list"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: 'var(--bf-surface, transparent)',
      }}
    >
      <div
        className="task-list-header"
        style={{
          display: 'grid',
          gridTemplateColumns: '100px minmax(0, 1fr) 140px 120px',
          gap: 12,
          padding: '8px 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--bf-text-muted, #8a8a8a)',
        }}
      >
        <span>Priority</span>
        <span>Task</span>
        <span>Status</span>
        <span>Assignee</span>
      </div>

      {tasks.map((task) => {
        const isSelected = selectedTaskId != null && String(selectedTaskId) === String(task.id);

        return (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectTask?.(task)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectTask?.(task); } }}
            className="task-list-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '100px minmax(0, 1fr) 140px 120px',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: 8,
              cursor: onSelectTask ? 'pointer' : 'default',
              background: isSelected
                ? 'var(--bf-surface-selected, rgba(59,130,246,0.1))'
                : 'var(--bf-surface-elevated, rgba(128,128,128,0.05))',
              border: `1px solid ${isSelected
                ? 'var(--bf-border-accent, rgba(59,130,246,0.5))'
                : 'var(--bf-border, rgba(128,128,128,0.15))'}`,
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            <div className="task-list-cell task-list-priority">
              <PriorityBadge
                priority={task.priority ?? 'none'}
                variant="badge"
                scale="sm"
                showLabel
              />
            </div>

            <div
              className="task-list-cell task-list-title"
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--bf-text-primary, #e4e4e4)',
              }}
              title={task.title}
            >
              <span
                style={{
                  color: 'var(--bf-text-muted, #8a8a8a)',
                  marginRight: 8,
                  fontWeight: 400,
                }}
              >
                {task.key || `#${task.id}`}
              </span>
              {task.title || '(untitled)'}
            </div>

            <div
              className="task-list-cell task-list-status"
              style={{
                fontSize: 12,
                color: 'var(--bf-text-secondary, #b4b4b4)',
                textTransform: 'capitalize',
              }}
            >
              {(task.status ?? 'todo').replace(/[_-]+/g, ' ')}
            </div>

            <div
              className="task-list-cell task-list-assignee"
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                color: 'var(--bf-text-secondary, #b4b4b4)',
              }}
              title={task.assigneeName || undefined}
            >
              {task.assigneeName || 'Unassigned'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
