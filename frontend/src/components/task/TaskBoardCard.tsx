'use client';

/**
 * TaskBoardCard — one draggable task card, shared by the status board and the
 * standup pivot in TaskMgmtContent. Pure presentation: every piece of state and
 * every handler comes in through props.
 */

import { memo, useCallback } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/Select';
import type { Formatter } from '@/i18n/format';
import { formatTaskDate } from '@/lib/taskMgmtDateUtils';
import { taskStatusBadgeClass } from '@/lib/taskStatus';
import type { Task } from '@/lib/builderforceApi';
import AssigneeHovercard from '../workforce/AssigneeHovercard';
import { AgentChip } from '../board/AgentChip';
import { TaskBadges } from './TaskBadges';

export interface TaskCardRun {
  key: string;
  label: string;
  status: string;
  execId: number;
}

export interface TaskBoardCardProps {
  task: Task;
  runs: TaskCardRun[];
  cardStyle: CSSProperties;
  fmt: Formatter;
  title: string;
  statusLabel: string;
  statusChoices: Array<{ value: string; label: string }>;
  editingStatus: boolean;
  flagged: boolean;
  participants: { completed: number; required: number; percent: number } | null;
  assigneeName: string;
  assigneeSelectValue: string;
  onDragStart: () => void;
  onOpen: (tab?: 'agent') => void;
  onEditStatus: (editing: boolean) => void;
  onPatchStatus: (status: string) => void;
}

function TaskBoardCardImpl({
  task,
  runs,
  cardStyle,
  fmt,
  title,
  statusLabel,
  statusChoices,
  editingStatus,
  flagged,
  participants,
  assigneeName,
  assigneeSelectValue,
  onDragStart,
  onOpen,
  onEditStatus,
  onPatchStatus,
}: TaskBoardCardProps) {
  const openCard = useCallback(() => onOpen(), [onOpen]);
  const openAgentTab = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onOpen('agent');
    },
    [onOpen],
  );
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={openCard}
      style={{ ...cardStyle, padding: 12, cursor: 'grab', position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 8, right: 8 }}>
        {editingStatus ? (
          <Select
            value={task.status}
            onChange={(e) => {
              e.stopPropagation();
              onPatchStatus(e.target.value);
              onEditStatus(false);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {statusChoices.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        ) : (
          <button
            type="button"
            aria-label={statusLabel}
            className={taskStatusBadgeClass(task.status)}
            style={{
              border: 'none',
              font: 'inherit',
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              textTransform: 'capitalize',
              cursor: 'pointer',
            }}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onEditStatus(true);
            }}
          >
            {statusLabel}
          </button>
        )}
      </div>
      <div style={{ fontWeight: 500, fontSize: 13, color: task.restricted ? 'var(--text-muted)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {task.restricted && <span aria-hidden style={{ flexShrink: 0 }}><Icon source="🔒" size="1em" /></span>}
        <span style={task.restricted ? { fontStyle: 'italic' } : undefined}>{title}</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 6,
          fontSize: 11,
          color: 'var(--text-muted)',
          flexWrap: 'wrap',
        }}
      >
        <TaskBadges task={task} showKey flagged={flagged} participants={participants} />
        {runs.length > 0 ? (
          // One chip per agent that has touched this task, newest run first, so
          // history reads left-to-right: a freshly-queued agent (Bob · pending)
          // sits ahead of a prior one (Kevin, completed). The status meta makes
          // the live state explicit for any non-completed run.
          runs.map((r) => (
            <AgentChip
              key={r.key}
              label={r.label}
              status={r.status}
              meta={r.status !== 'completed' ? r.status : undefined}
              title={`${r.label} — execution #${r.execId} · ${r.status}. Click to open the Agent tab.`}
              onClick={openAgentTab}
            />
          ))
        ) : (task.assignedAgentHostId || task.assignedAgentRef || task.assignedUserId) ? (
          // No run yet — show who it's assigned to, flagged "pending" when an
          // agent owns it so a just-dropped card reads "Bob · pending" before its
          // execution row materializes.
          (task.assignedAgentHostId || task.assignedAgentRef) ? (
            <AssigneeHovercard selectValue={assigneeSelectValue}>
              <AgentChip label={assigneeName} status="pending" meta="pending" title={`${assigneeName} — queued`} />
            </AssigneeHovercard>
          ) : (
            <AssigneeHovercard selectValue={assigneeSelectValue}>
              <span>{assigneeName}</span>
            </AssigneeHovercard>
          )
        ) : null}
        {task.githubPrUrl && (
          <a
            href={task.githubPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 600 }}
          >
            PR#{task.githubPrNumber ?? '—'}
          </a>
        )}
        {task.dueDate && <span style={{ marginLeft: 'auto' }}>{formatTaskDate(fmt, task.dueDate)}</span>}
      </div>
    </div>
  );
}

export const TaskBoardCard = memo(TaskBoardCardImpl);
