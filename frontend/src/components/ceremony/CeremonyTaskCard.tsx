'use client';

import type { Task } from '@/lib/builderforceApi';
import { DRAG_TASK } from './types';

const PRIORITY_CLASS: Record<string, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
};

/**
 * Compact, draggable task chip used across the ceremony surface (backlog rail,
 * seat stacks, epic drawers). Presentational — it carries the task id in the
 * native HTML5 dataTransfer so any drop target (seat / epic / sprint / stage)
 * can read it without prop-drilled drag state.
 */
export function CeremonyTaskCard({
  task,
  onOpen,
  compact = false,
}: {
  task: Task;
  onOpen?: (task: Task) => void;
  compact?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TASK, String(task.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen?.(task)}
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: compact ? '6px 8px' : 10,
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
      title={task.title}
    >
      <div
        style={{
          fontSize: compact ? 12 : 13,
          fontWeight: 500,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{task.key}</span>
        <span
          className={PRIORITY_CLASS[task.priority] ?? 'badge-gray'}
          style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, textTransform: 'capitalize' }}
        >
          {task.priority}
        </span>
      </div>
    </div>
  );
}
