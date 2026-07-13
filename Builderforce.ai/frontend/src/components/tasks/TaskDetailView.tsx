import React from 'react';
import { PriorityBadge, PriorityBadgeList, PriorityBadgeColumn } from '../PriorityBadge';
import type { Task } from './types';

/**
 * TaskDetailView — full-viewport detail view for a single task.
 *
 * FR3/AC3: A visual priority indicator is rendered prominently on the detail
 * view header, consistent with the badge/dot/icon variants shown on the
 * dashboard and list/kanban views.
 *
 * Contains subtask explorer, dependency list, and related tasks to keep the
 * full-screen focus needed for deep work (leads/ICs). Expected to bridge from
 * List/Kanban selection or friendly drill-down.
 */

export interface TaskDetailViewProps {
  task: Task;
  loading?: boolean;
  onClose?: () => void;
  onEdit?: (task: Task) => void;
}

export function TaskDetailView({
  task,
  loading = false,
  onClose,
  onEdit,
}: TaskDetailViewProps) {
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        gap: 16,
      }}>
        <span style={{ fontSize: 13, color: 'var(--bf-text-muted, #8a8a8a)' }}>
          Loading task details…
        </span>
        <div style={{
          width: 16,
          height: 16,
          border: '2px solid var(--bf-border, rgba(128,128,128,0.3))',
          borderTopColor: 'var(--bf-primary,rgba(59,130,246,0.8))',
          borderRadius: 999,
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const hasRelatedTasks = false; // TODO: wire up related tasks

  const onEditClick = () => onEdit?.(task);
  const onCloseClick = () => onClose?.();

  return (
    <div
      className="task-detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bf-surface, transparent)',
        overflow: 'hidden',
      }}
    >
      {/* HEADER SECTION WITH PRIORITY */}
      <div
        className="task-detail-header"
        style={{
          background: 'var(--bf-surface-elevated, rgba(128,128,128,0.05))',
          borderBottom: '1px solid var(--bf-border, rgba(128,128,128,0.15))',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {task.key && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'var(--bf-surface, transparent)',
                      color: 'var(--bf-text-muted, #8a8a8a)',
                    }}
                  >
                    {task.key}
                  </span>
                )}
                
                {/* FR3: Visual priority indicator prominently displayed */}
                <PriorityBadge
                  priority={task.priority ?? 'none'}
                  variant="header"
                  scale="lg"
                  showLabel
                  link={onTaskAction}
                />

                <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--bf-text-secondary, #b4b4b4)',
                  textTransform: 'capitalize',
                }}>
                  {(task.status ?? 'todo').replace(/[_-]+/g, ' ')}
                </span>
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 600,
                  color: 'var(--bf-text-primary, #e4e4e4)',
                  lineHeight: 1.4,
                }}
              >
                {task.title}
              </h1>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {onEdit && (
                <button
                  onClick={onEditClick}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    border: '1px solid var(--bf-border, rgba(128,128,128,0.15))',
                    background: 'var(--bf-surface, transparent)',
                    color: 'var(--bf-text-primary, #e4e4e4)',
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  Edit
                </button>
              )}
              {onClose && (
                <button
                  onClick={onCloseClick}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 6,
                    border: '1px solid var(--bf-border, rgba(128,128,128,0.15))',
                    background: 'var(--bf-surface, transparent)',
                    color: 'var(--bf-text-primary, #e4e4e4)',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>

          {/* PRIORITY HINT (for quick scan) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bf-text-muted, #8a8a8a)' }}>
              Priority:
            </span>
            <PriorityBadge
              priority={task.priority ?? 'none'}
              variant="icon"
              scale="sm"
              showLabel
              link={onTaskAction}
            />
            <span style={{ fontSize: 12, color: 'var(--bf-text-secondary, #b4b4b4)' }}>
              {task.priority ?? 'None'}
            </span>
          </div>

          {/* ASSIGNEE */}
          {task.assigneeName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'var(--bf-surface-elevated, rgba(128,128,128,0.1))',
                  border: '1px solid var(--bf-border, rgba(128,128,128,0.2))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 12,
                  color: 'var(--bf-text-primary, #e4e4e4)',
                }}
              >
                {task.assigneeName.charAt(0).toUpperCase()}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--bf-text-secondary, #b4b4b4)',
                  minWidth: 80,
                }}>
                  Assigned to
                </div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--bf-text-primary, #e4e4e4)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {task.assigneeName}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="task-detail-body" style={{
        flex: 1,
        overflowY: 'auto',
        padding: 20,
      }}>
        {/* DESCRIPTION */}
        {task.description && (
          <section style={{ marginBottom: 24 }}>
            <h3 style={{
              margin: '0 0 8px',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--bf-text-muted, #9ca3af)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Description
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--bf-text-primary, #e4e4e4)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {task.description}
            </p>
          </section>
        )}

        {/* SUBTASKS */}
        {hasSubtasks && (
          <section style={{ marginBottom: 24 }}>
            <h3 style={{
              margin: '0 0 12px',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--bf-text-muted, #9ca3af)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Subtasks
            </h3>
            <PriorityBadgeList
              items={task.subtasks!}
              variant="dot"
              scale="sm"
              compact
              renderItem={(subtask) => (
                <div
                  role="button"
                  tabIndex={0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--bf-surface-elevated, rgba(128,128,128,0.06))',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onClick={() => onTaskSelect?.(subtask)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskSelect?.(subtask); } }}
                >
                  <PriorityBadge
                    priority={subtask.priority}
                    variant="dot"
                    scale="sm"
                  />
                  <span style={{
                    flex: 1,
                    fontSize: 13,
                    color: 'var(--bf-text-primary, #e4e4e4)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {subtask.title || `(untitled #${subtask.id})`}
                  </span>
                  {subtask.status && (
                    <span style={{
                      fontSize: 11,
                      color: 'var(--bf-text-secondary, #b4b4b4)',
                      textTransform: 'capitalize',
                    }}>
                      {subtask.status.replace(/[_-]+/g, ' ')}
                    </span>
                  )}
                </div>
              )}
            />
          </section>
        )}

        {/* COMPLETED SUBTASKS SUMMARY */}
        {hasSubtasks && task.subtasks!.some(s => s.status?.toLowerCase() === 'done') && (
          <section style={{ marginBottom: 24 }}>
            <h3 style={{
              margin: '0 0 8px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--bf-text-muted, #6b7280)',
            }}>
              {task.subtasks!.filter(s => s.status?.toLowerCase() === 'done').length} of {task.subtasks!.length} completed
            </h3>
            <div style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--bf-surface, transparent)',
              overflow: 'hidden',
            }}>
              <div
                style={{
                  width: `${(task.subtasks!.filter(s => s.status?.toLowerCase() === 'done').length / task.subtasks!.length) * 100}%`,
                  height: '100%',
                  borderRadius: 3,
                  background: 'var(--bf-border-ok, rgba(59,130,246,0.8))',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
          </section>
        )}

        {/* RELATED TASKS (placeholder) */}
        {/* TODO: wire up related tasks list */}
        {hasRelatedTasks && (
          <section>
            <h3 style={{
              margin: '0 0 12px',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--bf-text-muted, #9ca3af)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Related Tasks
            </h3>
            <PriorityBadgeColumn
              items={[]}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function onTaskSelect(task: Task) {
  // TODO: wire up to main app router or view manager
  console.log('Selecting subtask:', task.id);
}

function onTaskAction(task: Task) {
  // Placeholder for linkable priority badge
}