'use client';

import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import type { Task } from '@/lib/builderforceApi';
import { taskTypeBadgeClass, taskTypeLabelKey } from '@/lib/taskType';
import { taskPriorityBadgeClass } from '@/lib/taskPriority';
import { BuildStatusBadge } from '@/components/board/BuildStatusBadge';

/**
 * The ticket's badge row — priority, work-item type, review verdict, audit flag,
 * role sign-off rollup, business value, BUILD verdict, PRD count.
 *
 * ONE component for every surface that shows them: the board card, the table row,
 * and the ticket drawer's header. It used to exist only on the card, which is why
 * opening a ticket LOST information — the drawer showed neither the flag nor the
 * sign-off rollup that had been sitting on the card the operator just clicked.
 *
 * Each badge decides its own visibility from the ticket, so callers pass the task
 * and (optionally) the two board-level signals the task row doesn't carry:
 * whether the ticket audit flagged it, and its participant progress.
 */

export interface TaskBadgeSignals {
  /** From the project's ticket audit — a required role/artifact is missing. */
  flagged?: boolean;
  /** Required-role sign-off rollup, when the board tracks participants. */
  participants?: { completed: number; required: number; percent: number } | null;
}

const chip = {
  fontSize: 10,
  padding: '2px 6px',
  borderRadius: 'var(--radius-sm)',
} as const;

/** Review-verdict tone: green complete, amber gaps, neutral when only a count. */
function reviewTone(verdict: Task['lastReviewVerdict']): { color: string; glyph: string } {
  if (verdict === 'complete') return { color: 'var(--success-text, var(--success))', glyph: '✓' };
  if (verdict === 'gaps') return { color: 'var(--warning-text, var(--warning))', glyph: '⚠' };
  return { color: 'var(--text-secondary)', glyph: '↻' };
}

export function TaskBadges({
  task,
  flagged = false,
  participants = null,
  showPriority = true,
  showKey = false,
}: TaskBadgeSignals & {
  task: Task;
  /** The card renders priority itself alongside the status pill; the drawer doesn't. */
  showPriority?: boolean;
  /** Lead with the monospace ticket key (board card layout). */
  showKey?: boolean;
}) {
  const tBoard = useTranslations('board');
  const tCommon = useTranslations('common');
  const typeClass = taskTypeBadgeClass(task.taskType);
  const review = reviewTone(task.lastReviewVerdict);

  return (
    <>
      {showKey && <span style={{ fontFamily: 'var(--font-mono)' }}>{task.key}</span>}
      {showPriority && (
        <span className={taskPriorityBadgeClass(task.priority)} style={{ ...chip, textTransform: 'capitalize' }}>
          {task.priority}
        </span>
      )}
      {typeClass && (
        <span className={typeClass} style={chip}>{tCommon(taskTypeLabelKey(task.taskType))}</span>
      )}
      {task.reviewCount ? (
        <span
          title={
            task.lastReviewVerdict === 'complete' ? tCommon('reviewComplete')
              : task.lastReviewVerdict === 'gaps' ? tCommon('reviewGaps')
                : undefined
          }
          style={{
            ...chip, display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--bg-elevated)', color: review.color, fontWeight: 600,
          }}
        >
          <Icon source={review.glyph} size={13} /> {tCommon('reviewedTimes', { count: task.reviewCount })}
        </span>
      ) : null}
      {flagged && (
        <span
          title={tBoard('audit.flaggedTitle')}
          style={{
            ...chip, display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--danger-bg)', color: 'var(--danger-text)', fontWeight: 700,
          }}
        >
          
          <Icon source="⚑" size="1em" /> {tBoard('audit.flagged')}
        </span>
      )}
      {participants && participants.required > 0 && (
        <span
          title={tBoard('audit.participantsTitle')}
          style={{
            ...chip, display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700,
            background: participants.percent >= 100 ? 'var(--success-bg)' : 'var(--bg-deep)',
            color: participants.percent >= 100 ? 'var(--success-text)' : 'var(--text-secondary)',
          }}
        >
          
          <Icon source="✅" size="1em" /> {participants.completed}/{participants.required}
        </span>
      )}
      {task.businessValue != null && (
        <span
          title={task.businessValueRationale ?? tBoard('businessValue.badgeTitle')}
          style={{
            ...chip, background: 'var(--surface-interactive, var(--bg-elevated))',
            color: 'var(--text-secondary)', fontWeight: 700,
          }}
        >
          {tBoard('businessValue.badge', { value: task.businessValue })}
        </span>
      )}
      {/* THE BUILD VERDICT. Placed with the other state badges rather than beside the PR
          link, because it is a fact about the ticket's readiness, not about the link —
          and because the table row and the drawer show this row too, which is how the
          card and the ticket stopped disagreeing about whether the build was red. */}
      <BuildStatusBadge status={task.buildStatus} />
      {task.specCount ? (
        <span
          title={tBoard('prdBadgeTitle', { count: task.specCount })}
          style={{ ...chip, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >
          
          <Icon source="📄" size="1em" /> PRD{task.specCount > 1 ? ` ×${task.specCount}` : ''}
        </span>
      ) : null}
    </>
  );
}
