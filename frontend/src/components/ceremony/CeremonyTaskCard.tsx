'use client';

import { useTranslations } from 'next-intl';
import type { Task } from '@/lib/builderforceApi';
import { DRAG_TASK } from './types';
import { taskPriorityBadgeClass } from '@/lib/taskPriority';
import { useCeremonyPick } from './pickToPlace';
import { setDragGhost } from './dragGhost';

/**
 * Compact, draggable task chip used across the ceremony surface (backlog rail,
 * seat stacks, epic drawers). Presentational — it carries the task id in the
 * native HTML5 dataTransfer so any drop target (seat / epic / sprint / stage)
 * can read it without prop-drilled drag state.
 *
 * It ALSO offers a pick button, because `dragstart` never fires on touch and
 * that made the whole stage read-only on a phone. See `pickToPlace.tsx`.
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
  const t = useTranslations('ceremony');
  const pick = useCeremonyPick();
  const isPicked = pick?.pickedTaskId === task.id;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TASK, String(task.id));
        e.dataTransfer.effectAllowed = 'move';
        // A REAL DRAG GHOST. The browser's default is a translucent snapshot of the
        // element under the cursor, which on a dense stage is a washed-out rectangle you
        // cannot identify — so you drop by position and hope. A purpose-built ghost
        // naming the ticket is the one affordance the pick-to-place path (which
        // highlights its target explicitly) already had and dragging did not.
        setDragGhost(e, task.key ? `${task.key} · ${task.title}` : task.title);
      }}
      onClick={() => onOpen?.(task)}
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: compact ? '6px 8px' : 10,
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        outline: isPicked ? '2px solid var(--coral-bright)' : undefined,
        outlineOffset: isPicked ? 1 : undefined,
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
          className={taskPriorityBadgeClass(task.priority)}
          style={{ fontSize: 9, padding: '1px 6px', borderRadius: 'var(--radius-sm)', textTransform: 'capitalize' }}
        >
          {task.priority}
        </span>
        {pick && (
          <button
            type="button"
            aria-pressed={isPicked}
            aria-label={isPicked ? t('putDown', { title: task.title }) : t('pickUp', { title: task.title })}
            onClick={(event) => { event.stopPropagation(); pick.pick(task.id, task.title); }}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isPicked ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              background: isPicked ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              color: isPicked ? 'var(--coral-bright)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {isPicked ? t('placeHint') : t('move')}
          </button>
        )}
      </div>
    </div>
  );
}
