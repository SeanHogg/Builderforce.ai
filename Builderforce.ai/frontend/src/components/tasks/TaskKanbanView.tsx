import React, { useState } from 'react';
import { PriorityBadge } from '../PriorityBadge';
import type { Task } from './types';

/**
 * TaskKanbanView — Kanban-board-shaped display of project tasks.
 *
 * FR2/AC2: Visual priority indicators are rendered on every task card using
 * the shared PriorityBadge component (dots/badges/icons consistent with the
 * dashboard).
 *
 * Supports drag-and-drop semantics (visually, metadata remains until the host
 * owns a drop handler). Each column shows an inline priority hint so PMs,
 * leads, and ICs can scan importance at a glance.
 */

export interface TaskKanbanViewProps {
  tasks: Task[];
  loading?: boolean;
  onTaskSelect?: (task: Task) => void;
  sortFn?: (a: Task, b: Task) => number;
}

const COLUMNS = [
  { key: 'todo', label: 'To Do', minCount: 0 },
  { key: 'in_progress', label: 'In Progress', minCount: 0 },
  { key: 'in_review', label: 'In Review', minCount: 0 },
  { key: 'done', label: 'Done', minCount: 0 },
  { key: 'blocked', label: 'Blocked', minCount: 0 },
] as const;

export function TaskKanbanView({
  tasks,
  loading = false,
  onTaskSelect,
  sortFn,
}: TaskKanbanViewProps) {
  const [draggedId, setDraggedId] = useState<string | number | null>(null);

  if (loading) {
    return (
      <div
        className="kanban-loading"
        style={{
          display: 'flex',
          height: '100%',
          padding: 16,
          gap: 12,
          overflowX: 'auto',
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: '0 0 280px',
              height: 400,
              borderRadius: 12,
              background: 'var(--bf-surface-elevated, rgba(128,128,128,0.08))',
              animation: 'pulse 1.6s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    );
  }

  // Group tasks into columns
  const columns = COLUMNS.map((col) => ({
    ...col,
    tasks: tasks
      .filter((t) => (t.status ?? '').toLowerCase() === col.key.toLowerCase())
      .map((task) => ({ ...task })), // shallow copy for stability
  }));

  const handleDragStart = (taskId: string | number) => {
    setDraggedId(taskId);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  return (
    <div className="kanban-board" style={{ display: 'flex', height: '100%', padding: 16, gap: 12, overflowX: 'auto' }}>
      {columns.map((column) => {
        const count = column.tasks.length;
        const columnHasTasks = count > 0;

        return (
          <div
            key={column.key}
            className="kanban-column"
            style={{
              flex: '0 0 minmax(0, 260px)',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              borderRadius: 12,
              background: columnHasTasks
                ? 'var(--bf-surface, transparent)'
                : 'transparent',
              border: columnHasTasks ? '1px solid var(--bf-border, rgba(128,128,128,0.15))' : 'none',
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDraggedId(null);
            }}
          >
            <div className="kanban-column-header" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              marginBottom: 8,
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--bf-text-primary, #e4e4e4)',
            }}>
              <span>{column.label}</span>
              <span style={{
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--bf-surface-elevated, rgba(128,128,128,0.08))',
                color: 'var(--bf-text-secondary, #9ca3af)',
                textTransform: 'uppercase',
              }}>
                {count}
              </span>
            </div>

            <div className="kanban-column-body" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flex: 1,
              overflowY: 'auto',
              padding: '0 8px 8px',
            }}>
              {!columnHasTasks && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 120,
                  padding: 16,
                  color: `var(--bf-text-muted, ${column.key === 'todo' ? '#6b7280' : '#9ca3af'})`,
                  textAlign: 'center',
                  gap: 6,
                  borderRadius: 8,
                  background: 'var(--bf-surface-elevated, rgba(128,128,128,0.08))',
                }}>
                  <span style={{ fontSize: 16, opacity: 0.5 }}>📋</span>
                  <span style={{ fontSize: 12 }}>{column.label.toLowerCase()}</span>
                </div>
              )}

              {column.tasks.map((task, i) => {
                const isSelected = false; // TODO: tie to onTaskSelect state
                const hasPriority = task.priority != null && task.priority !== 'none';

                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    draggable={onTaskSelect != null}
                    onDragStart={() => onTaskSelect ? handleDragStart(task.id) : undefined}
                    onDragEnd={onTaskSelect ? handleDragEnd : undefined}
                    className="kanban-card"
                    style={{
                      borderRadius: 10,
                      padding: 12,
                      background: isSelected
                        ? 'var(--bf-surface-selected, rgba(59,130,246,0.1))'
                        : 'var(--bf-surface-elevated, rgba(128,128,128,0.06))',
                      border: isSelected
                        ? '1px solid var(--bf-border-accent, rgba(59,130,246,0.5))'
                        : `1px solid ${draggedId === task.id
                          ? 'var(--bf-border, rgba(128,128,128,0.3))'
                          : 'var(--bf-border, rgba(128,128,128,0.12))'}`,
                      cursor: onTaskSelect ? 'pointer' : 'default',
                      transition: 'background 0.15s, border-color 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                    title={`${task.key || '#' + task.id}: ${task.title || '(untitled)'}`}
                    onClick={() => onTaskSelect?.(task)}
                    onKeyDown={(e) => { if (onTaskSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTaskSelect(task); } }}
                  >
                    {hasPriority && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PriorityBadge
                          priority={task.priority}
                          variant="dot"
                          scale="sm"
                          showLabel
                        />
                        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--bf-text-muted, #9ca3af)' }}>
                          {getPriorityLabel(task.priority)}
                        </span>
                      </div>
                    )}

                    <div style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--bf-text-primary, #e4e4e4)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      <span
                        style={{ color: 'var(--bf-text-muted, #8a8a8a)', marginRight: 4, fontWeight: 400 }}
                      >
                        {task.key || '#' + task.id}
                      </span>
                      {task.title || '(untitled)'}
                    </div>

                    {task.assigneeName && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 4,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: 'var(--bf-surface, transparent)',
                        fontSize: 11,
                        color: 'var(--bf-text-secondary, #b4b4b4)',
                      }}>
                        <span style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: 'var(--bf-border, rgba(128,128,128,0.3))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 9,
                        }}>
                          {task.assigneeName.charAt(0).toUpperCase()}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.assigneeName}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getPriorityLabel(priority: string): string | null {
  const p = priority.toLowerCase().replace(/[^a-z]/g, '');
  switch (p) {
    case 'urgent':
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MED';
    case 'low':
      return 'LOW';
    default:
      return null;
  }
}